"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSupportedSourceFile = isSupportedSourceFile;
exports.scanRepositoryWithStats = scanRepositoryWithStats;
exports.scanRepository = scanRepository;
exports.estimateRawSourceStats = estimateRawSourceStats;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Absolute ceiling: above this we never parse, even authored source, to protect
// the process. Such files are still RECORDED as skipped blindspots (not hidden).
const HARD_MAX_FILE_BYTES = 8 * 1024 * 1024;
/**
 * Decide whether an over-cap file is a minified/generated blob (skip the parse,
 * its symbols would be noise) or genuinely large authored source (still parse —
 * dropping it would leave a real hole in repo coverage). Content-based, not size.
 */
function isLikelyMinified(filePath) {
    let fd = null;
    try {
        fd = fs_1.default.openSync(filePath, 'r');
        const buf = Buffer.alloc(131072); // peek first 128KB
        const read = fs_1.default.readSync(fd, buf, 0, buf.length, 0);
        if (read === 0)
            return false;
        const text = buf.toString('utf8', 0, read);
        let newlines = 0, maxLine = 0, cur = 0;
        for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 10) {
                newlines++;
                if (cur > maxLine)
                    maxLine = cur;
                cur = 0;
            }
            else
                cur++;
        }
        if (cur > maxLine)
            maxLine = cur;
        // Minified signature: almost no newlines, or extremely long average/peak lines.
        if (newlines === 0)
            return true;
        if (maxLine > 5000)
            return true;
        if (read / newlines > 2000)
            return true;
        return false;
    }
    catch {
        return false;
    }
    finally {
        if (fd !== null)
            try {
                fs_1.default.closeSync(fd);
            }
            catch { /* ignore */ }
    }
}
// NO CAPS: scans never STOP. The scanner walks the entire tree end-to-end so
// `discovered == represented` on every repo. maxFiles/maxBytes/maxScanMs are kept
// in ScanOptions for back-compat but are intentionally NOT enforced as stops —
// a tool that quits at file N leaves N+1..end invisible and forces raw reads,
// which defeats the entire token-saving premise. Per-file size classification
// (below) still applies: huge/minified blobs get a represented stub, never a parse.
// Per-file cap: files larger than this are almost always minified bundles or
// generated blobs. tree-sitter parses them pathologically slowly (a single 2MB
// bundle can stall an entire repo), and their symbols are noise. Skip them.
const DEFAULT_MAX_FILE_BYTES = Number(process.env.OMNICODE_MAX_FILE_BYTES || 512 * 1024);
const IGNORE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '_next', 'out', '.vscode',
    'coverage', '.turbo', '.cache', '.parcel-cache', '.svelte-kit', '.nuxt', '.output',
    'vendor', 'venv', '.venv', 'env', '.env', '__pycache__', '.pytest_cache', '.mypy_cache',
    'target', 'bin', 'obj', '.gradle', '.idea', 'Pods', 'DerivedData', 'generated', 'coverage',
    '$PLUGINSDIR', 'decompiled', 'extracted_full', 'app_extracted', 'release', 'releases'
]);
// Dot-directories that hold REAL project files (CI, editor, tooling config). These
// must NOT be blanket-skipped just for starting with a dot — that loses authored
// content. Everything else dot-prefixed (.git, .cache, our own .omnicode) is skipped.
const ALLOW_DOT_DIRS = new Set([
    '.github', '.gitlab', '.circleci', '.azure', '.azuredevops', '.vscode', '.config',
    '.husky', '.changeset', '.devcontainer', '.storybook', '.chromatic', '.yarn',
]);
const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.cs', '.java', '.kt', '.php', '.rb', '.swift', '.c', '.h', '.cpp', '.hpp', '.sol', '.lua']);
const EXTRA_BENCHMARK_EXTENSIONS = new Set(['.json', '.md', '.yaml', '.yml']);
const GENERATED_PATH_PARTS = [
    `${path_1.default.sep}$PLUGINSDIR${path_1.default.sep}`,
    `${path_1.default.sep}decompiled${path_1.default.sep}`,
    `${path_1.default.sep}extracted_full${path_1.default.sep}`,
    `${path_1.default.sep}app_extracted${path_1.default.sep}`,
    `${path_1.default.sep}static${path_1.default.sep}chunks${path_1.default.sep}`,
    `${path_1.default.sep}static${path_1.default.sep}webpack${path_1.default.sep}`,
    `${path_1.default.sep}generated${path_1.default.sep}`,
    `${path_1.default.sep}coverage${path_1.default.sep}`,
];
function isGeneratedArtifactPath(filePath) {
    const normalized = path_1.default.normalize(filePath);
    return GENERATED_PATH_PARTS.some((part) => normalized.includes(part));
}
function normalizeForMatch(p) {
    return path_1.default.normalize(p).replace(/\\/g, '/');
}
function simpleIgnoreMatch(filePath, repoPath, patterns) {
    if (!patterns.length)
        return false;
    const rel = normalizeForMatch(path_1.default.relative(repoPath, filePath));
    const abs = normalizeForMatch(filePath);
    for (const raw of patterns) {
        const p = normalizeForMatch(String(raw).trim());
        if (!p)
            continue;
        const core = p
            .replace(/^\*\*\//, '')
            .replace(/\/\*\*$/, '')
            .replace(/\*\*/g, '')
            .replace(/\*/g, '');
        if (!core)
            continue;
        if (rel === core || rel.startsWith(`${core}/`) || rel.includes(`/${core}/`))
            return true;
        if (abs.includes(core))
            return true;
    }
    return false;
}
function toLang(ext) {
    return ext.startsWith('.') ? ext.substring(1) : ext;
}
function isSupportedSourceFile(fileName, includeJson = false) {
    const ext = path_1.default.extname(fileName);
    if (SUPPORTED_EXTENSIONS.has(ext))
        return true;
    return includeJson && EXTRA_BENCHMARK_EXTENSIONS.has(ext);
}
function scanRepositoryWithStats(repoPath, options = {}) {
    const started = Date.now();
    const maxFileBytes = Math.max(1024, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
    const includeJson = !!options.includeJson;
    const ignorePatterns = options.ignorePatterns || [];
    const files = [];
    const skipped = [];
    const stats = {
        discoveredFiles: 0,
        indexedCandidates: 0,
        sourceBytes: 0,
        skippedDirs: 0,
        skippedFiles: 0,
        generatedSkipped: 0,
        oversizedSkipped: 0,
        maxFilesHit: false,
        maxBytesHit: false,
        timeLimitHit: false,
        scanMs: 0,
        stopReason: null,
        excludedDirs: [],
    };
    const recordExcluded = (full, name, reason) => stats.excludedDirs.push({ dir: path_1.default.relative(repoPath, full) || name, reason });
    if (!fs_1.default.existsSync(repoPath)) {
        stats.stopReason = 'repo_path_missing';
        return { files, skipped, stats };
    }
    const stack = [repoPath];
    while (stack.length > 0) {
        // NO CAPS: no time/file-count/byte stop. The walk always completes.
        const dir = stack.pop();
        let entries = [];
        try {
            entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            stats.skippedDirs++;
            continue;
        }
        // Stable order makes benchmark runs repeatable and puts source-looking folders first.
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const fullPath = path_1.default.join(dir, entry.name);
            // Skip ignore dirs (deps/build/vcs caches) and dot-DIRECTORIES — but NOT the
            // ones that hold real project config (.github, .vscode, …). Every skip is
            // RECORDED, never silent. Dot-FILES (.env, .npmrc) always flow through.
            if (entry.isDirectory()) {
                const ignored = IGNORE_DIRS.has(entry.name);
                const blockedDot = entry.name.startsWith('.') && !ALLOW_DOT_DIRS.has(entry.name);
                if (ignored || blockedDot) {
                    stats.skippedDirs++;
                    recordExcluded(fullPath, entry.name, ignored ? 'dependency/build/vcs cache' : 'dot-directory');
                    continue;
                }
            }
            if (simpleIgnoreMatch(fullPath, repoPath, ignorePatterns)) {
                if (entry.isDirectory()) {
                    stats.skippedDirs++;
                    recordExcluded(fullPath, entry.name, 'ignore-pattern');
                }
                else
                    stats.skippedFiles++;
                continue;
            }
            if (isGeneratedArtifactPath(fullPath)) {
                if (entry.isDirectory()) {
                    stats.skippedDirs++;
                    recordExcluded(fullPath, entry.name, 'generated-path');
                }
                else
                    stats.generatedSkipped++;
                continue;
            }
            if (entry.isSymbolicLink()) {
                stats.skippedFiles++;
                continue;
            }
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (!entry.isFile()) {
                stats.skippedFiles++;
                continue;
            }
            stats.discoveredFiles++;
            if (!isSupportedSourceFile(entry.name, includeJson)) {
                // Unsupported extension: don't drop it silently (that's an invisible
                // token leak). Record it so the indexer represents it as a Tier-4 stub
                // row — the agent can still reach it without a raw read.
                try {
                    const st = fs_1.default.statSync(fullPath);
                    if (st.size > 0)
                        skipped.push({ path: fullPath, size: st.size, reason: 'unsupported_ext' });
                }
                catch {
                    stats.skippedFiles++;
                }
                continue;
            }
            try {
                const stat = fs_1.default.statSync(fullPath);
                if (stat.size <= 0)
                    continue;
                // Over the per-file cap: classify rather than blindly drop, so we never
                // lose authored source and every skip is a visible, typed blindspot.
                if (stat.size > maxFileBytes) {
                    if (stat.size > HARD_MAX_FILE_BYTES) {
                        stats.oversizedSkipped++;
                        skipped.push({ path: fullPath, size: stat.size, reason: 'too_large' });
                        continue;
                    }
                    if (isLikelyMinified(fullPath)) {
                        stats.oversizedSkipped++;
                        skipped.push({ path: fullPath, size: stat.size, reason: 'minified' });
                        continue;
                    }
                    // Large but authored — index it. Coverage over speed.
                }
                const ext = path_1.default.extname(entry.name);
                files.push({ path: fullPath, lang: toLang(ext), size: stat.size });
                stats.indexedCandidates++;
                stats.sourceBytes += stat.size;
            }
            catch {
                stats.skippedFiles++;
            }
        }
    }
    stats.scanMs = Date.now() - started;
    return { files, skipped, stats };
}
function scanRepository(repoPath, options = {}) {
    return scanRepositoryWithStats(repoPath, options).files;
}
function estimateRawSourceStats(repoPath, options = {}) {
    const { files, stats } = scanRepositoryWithStats(repoPath, { ...options, includeJson: true });
    return {
        files: files.length,
        bytes: stats.sourceBytes,
        tokens: Math.ceil(stats.sourceBytes / 4),
        stats,
    };
}
