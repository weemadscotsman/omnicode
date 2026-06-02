"use strict";
// ───────────────────────────────────────────────────────────────────────────
// Archive ingestion. Streams a .zip/.cbz/.epub/.jar to a temp dir one entry at
// a time (low memory — never loads the whole archive), then the normal indexer
// runs over the extracted tree.
//
// Hardened, because archives are attacker-controlled input:
//   • zip-slip  — entry names that escape the temp dir (../../etc/passwd) are blocked
//   • zip-bomb  — caps on per-file AND total UNCOMPRESSED size (not compressed)
//   • caps      — maxFiles / maxBytes / maxScanMs, same family as the dir scanner
//   • junk-skip — same .git/node_modules/min/map patterns as the dir scanner
// ───────────────────────────────────────────────────────────────────────────
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isArchivePath = isArchivePath;
exports.resolveContainedPath = resolveContainedPath;
exports.extractArchive = extractArchive;
exports.cleanupArchive = cleanupArchive;
const fs_1 = __importDefault(require("fs"));
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
const yauzl_1 = __importDefault(require("yauzl"));
const promises_2 = require("stream/promises");
const ARCHIVE_EXTS = ['.zip', '.cbz', '.epub', '.jar'];
function isArchivePath(p) {
    return ARCHIVE_EXTS.includes(path_1.default.extname(p).toLowerCase());
}
const SKIP_RE = [
    /(^|\/)\.git\//, /(^|\/)node_modules\//, /(^|\/)dist\//, /(^|\/)build\//,
    /(^|\/)\.next\//, /\.min\.(js|css)$/, /\.map$/, /\.pyc$/, /__pycache__/,
];
function isJunkEntry(name) { return SKIP_RE.some((r) => r.test(name)); }
const DEFAULTS = {
    maxFiles: Number(process.env.OMNICODE_MAX_FILES || 20000),
    maxBytes: Number(process.env.OMNICODE_MAX_BYTES || 250 * 1024 * 1024),
    maxScanMs: Number(process.env.OMNICODE_MAX_SCAN_MS || 600000),
    maxFileBytes: Number(process.env.OMNICODE_MAX_FILE_BYTES || 512 * 1024),
};
/**
 * Resolve a zip entry name to a safe absolute path under `root`, or null if it
 * would escape (zip-slip). Exported for direct testing of the containment rule.
 */
function resolveContainedPath(root, entryName) {
    // Normalize separators; reject absolute or drive-qualified names outright.
    const normalizedName = entryName.replace(/\\/g, '/');
    if (path_1.default.isAbsolute(normalizedName) || /^[A-Za-z]:/.test(normalizedName))
        return null;
    const safeRoot = path_1.default.resolve(root);
    const out = path_1.default.resolve(safeRoot, normalizedName);
    if (out !== safeRoot && !out.startsWith(safeRoot + path_1.default.sep))
        return null;
    return out;
}
async function extractArchive(archivePath, options = {}) {
    if (!fs_1.default.existsSync(archivePath))
        throw new Error(`Archive not found: ${archivePath}`);
    const maxFiles = options.maxFiles ?? DEFAULTS.maxFiles;
    const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
    const maxScanMs = options.maxScanMs ?? DEFAULTS.maxScanMs;
    const maxFileBytes = options.maxFileBytes ?? DEFAULTS.maxFileBytes;
    const hash = crypto_1.default.createHash('sha256').update(path_1.default.resolve(archivePath)).digest('hex').slice(0, 16);
    const dir = path_1.default.join(os_1.default.tmpdir(), `omnicode-zip-${hash}`);
    await promises_1.default.rm(dir, { recursive: true, force: true }).catch(() => undefined); // fresh extraction
    await promises_1.default.mkdir(dir, { recursive: true });
    const skipped = [];
    let filesExtracted = 0, bytesExtracted = 0, stopReason = null;
    const started = Date.now();
    const zip = await new Promise((resolve, reject) => yauzl_1.default.open(archivePath, { lazyEntries: true }, (err, zf) => err || !zf ? reject(err || new Error('zip open failed')) : resolve(zf)));
    await new Promise((resolve, reject) => {
        let done = false;
        const finish = () => { if (!done) {
            done = true;
            try {
                zip.close();
            }
            catch { /* */ }
            resolve();
        } };
        zip.on('error', (e) => {
            if (done)
                return;
            // yauzl's own zip-slip / malformed-name defense fires here ("invalid
            // relative path", "invalid characters"). Treat it as a blocked entry and
            // finish with whatever safe files were already extracted — don't fail the
            // whole ingest because the archive contained one hostile entry.
            if (/invalid (relative path|characters)/i.test(e.message)) {
                const bad = e.message.replace(/^.*?:\s*/, '').trim() || '(unknown)';
                skipped.push({ name: bad, reason: 'path_traversal_blocked' });
                finish();
            }
            else {
                done = true;
                reject(e);
            }
        });
        zip.on('end', finish);
        zip.on('entry', (entry) => {
            void (async () => {
                try {
                    if (Date.now() - started > maxScanMs) {
                        stopReason = `scan_time_limit_${maxScanMs}ms`;
                        return finish();
                    }
                    if (filesExtracted >= maxFiles) {
                        stopReason = `max_files_${maxFiles}`;
                        return finish();
                    }
                    const name = entry.fileName;
                    if (name.endsWith('/'))
                        return zip.readEntry(); // directory entry
                    if (isJunkEntry(name)) {
                        skipped.push({ name, reason: 'junk' });
                        return zip.readEntry();
                    }
                    if (entry.uncompressedSize > maxFileBytes) {
                        skipped.push({ name, reason: 'oversized' });
                        return zip.readEntry();
                    }
                    if (bytesExtracted + entry.uncompressedSize > maxBytes) {
                        stopReason = `max_bytes_${maxBytes}`;
                        return finish();
                    }
                    const outPath = resolveContainedPath(dir, name);
                    if (!outPath) {
                        skipped.push({ name, reason: 'path_traversal_blocked' });
                        return zip.readEntry();
                    }
                    await promises_1.default.mkdir(path_1.default.dirname(outPath), { recursive: true });
                    await new Promise((res, rej) => {
                        zip.openReadStream(entry, (err, rs) => {
                            if (err || !rs)
                                return rej(err || new Error('read stream failed'));
                            (0, promises_2.pipeline)(rs, fs_1.default.createWriteStream(outPath)).then(() => res()).catch(rej);
                        });
                    });
                    filesExtracted++;
                    bytesExtracted += entry.uncompressedSize;
                    zip.readEntry();
                }
                catch {
                    skipped.push({ name: entry.fileName, reason: 'extract_error' });
                    zip.readEntry();
                }
            })();
        });
        zip.readEntry();
    });
    return { dir, archivePath, filesExtracted, bytesExtracted, stopReason, skipped };
}
/** Remove an extracted archive's temp dir. */
async function cleanupArchive(extracted) {
    await promises_1.default.rm(extracted.dir, { recursive: true, force: true }).catch(() => undefined);
}
