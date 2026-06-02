"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.indexProject = indexProject;
exports.indexSingleFile = indexSingleFile;
const db_1 = require("../store/db");
const scanner_1 = require("../engine/scanner");
const parser_1 = require("../engine/parser");
const parse_pool_1 = require("../engine/parse_pool");
const embeddings_1 = require("../engine/embeddings");
const sandbox_1 = require("../security/sandbox");
const session_memory_1 = require("../engine/session_memory");
const resolution_1 = require("../engine/resolution");
const config_1 = require("../engine/config");
const archive_loader_1 = require("../engine/archive_loader");
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
function indexFingerprint(files) {
    const h = crypto_1.default.createHash('sha256');
    for (const file of files)
        h.update(file.path).update('\0').update(String(file.size)).update('\n');
    return h.digest('hex');
}
async function indexProject(repoPath, onProgress, options = {}) {
    repoPath = (0, config_1.resolveConfiguredRepoPath)(repoPath);
    // Archive ingestion: a .zip/.cbz/.epub/.jar is streamed to a temp dir (hardened
    // against zip-slip + zip-bomb), then indexed like any directory. The index is
    // keyed by the extracted dir; callers query that path.
    let archive = null;
    if ((0, archive_loader_1.isArchivePath)(repoPath)) {
        archive = await (0, archive_loader_1.extractArchive)(repoPath, options);
        repoPath = archive.dir;
    }
    options = (0, config_1.mergeConfigOptions)(repoPath, options);
    // Refuse drive roots, UNC share roots, and system/home dirs before touching disk.
    (0, sandbox_1.assertIndexableRoot)(repoPath);
    const db = (0, db_1.initDb)(repoPath);
    const scanResult = (0, scanner_1.scanRepositoryWithStats)(repoPath, options);
    const files = scanResult.files;
    const fingerprint = indexFingerprint(files);
    const scannedPaths = new Set(files.map((file) => file.path));
    let newlyIndexed = 0;
    let totalSymbols = 0;
    let totalBlindspots = 0;
    let currentFileCount = 0;
    let processedThisRun = 0;
    let indexIncomplete = false;
    const resumeEnabled = options.resume !== false && !options.force;
    const previousFingerprint = (0, db_1.getIndexMeta)(db, 'index_resume_fingerprint');
    const previousState = (0, db_1.getIndexMeta)(db, 'index_resume_state');
    const previousCursor = Number((0, db_1.getIndexMeta)(db, 'index_resume_cursor') || '0');
    const resumeStartIndex = resumeEnabled && previousState === 'in_progress' && previousFingerprint === fingerprint
        ? Math.max(0, Math.min(previousCursor, files.length))
        : 0;
    const maxIndexFilesPerRun = Math.max(0, Number(options.maxIndexFilesPerRun ?? process.env.OMNICODE_INDEX_MAX_FILES_PER_RUN ?? 0));
    currentFileCount = resumeStartIndex;
    (0, db_1.setIndexMeta)(db, 'index_resume_state', files.length > 0 ? 'in_progress' : 'complete');
    (0, db_1.setIndexMeta)(db, 'index_resume_fingerprint', fingerprint);
    (0, db_1.setIndexMeta)(db, 'index_resume_cursor', String(resumeStartIndex));
    (0, db_1.setIndexMeta)(db, 'index_resume_total', String(files.length));
    const insertFile = db.prepare(`
    INSERT INTO files (id, path, lang, size, lines, hash, parser_mode, parse_quality, language_name)
    VALUES (@id, @path, @lang, @size, @lines, @hash, @parser_mode, @parse_quality, @language_name)
    ON CONFLICT(path) DO UPDATE SET
      lang=excluded.lang,
      size=excluded.size,
      lines=excluded.lines,
      hash=excluded.hash,
      parser_mode=excluded.parser_mode,
      parse_quality=excluded.parse_quality,
      language_name=excluded.language_name,
      indexed_at=CURRENT_TIMESTAMP
  `);
    const deleteSymbols = db.prepare(`DELETE FROM symbols WHERE file_id = ?`);
    const deleteBlindspots = db.prepare(`DELETE FROM blindspots WHERE file_id = ?`);
    const deleteFile = db.prepare(`DELETE FROM files WHERE id = ?`);
    const insertSymbol = db.prepare(`
    INSERT INTO symbols (id, name, kind, file_id, line, byte_start, byte_end, snippet)
    VALUES (@id, @name, @kind, @file_id, @line, @byte_start, @byte_end, @snippet)
  `);
    const insertCallEdge = db.prepare(`
    INSERT INTO call_edges (id, from_symbol, to_symbol, file_id)
    VALUES (@id, @from_symbol, @to_symbol, @file_id)
  `);
    const insertEmbedding = db.prepare(`
    INSERT INTO symbol_embeddings (symbol_id, embedding)
    VALUES (@symbol_id, @embedding)
  `);
    const insertBlindspot = db.prepare(`
    INSERT INTO blindspots (id, file_id, reason)
    VALUES (@id, @file_id, @reason)
  `);
    const insertImport = db.prepare(`
    INSERT INTO imports (id, from_file_id, specifier)
    VALUES (@id, @from_file_id, @specifier)
  `);
    const deleteImports = db.prepare(`DELETE FROM imports WHERE from_file_id = ?`);
    const deleteCallEdges = db.prepare(`DELETE FROM call_edges WHERE file_id = ?`);
    const touchIndexedAt = db.prepare(`UPDATE files SET indexed_at = CURRENT_TIMESTAMP WHERE id = ?`);
    const existingFiles = db.prepare(`SELECT id, path FROM files`).all();
    const staleFiles = existingFiles.filter((file) => !scannedPaths.has(file.path));
    if (staleFiles.length > 0) {
        db.transaction(() => {
            for (const stale of staleFiles) {
                deleteCallEdges.run(stale.id);
                db.prepare(`DELETE FROM symbol_embeddings WHERE symbol_id IN (SELECT id FROM symbols WHERE file_id = ?)`).run(stale.id);
                deleteSymbols.run(stale.id);
                deleteBlindspots.run(stale.id);
                deleteImports.run(stale.id);
                db.prepare(`DELETE FROM imports WHERE to_file_id = ?`).run(stale.id);
                deleteFile.run(stale.id);
            }
        })();
    }
    const BATCH_SIZE = 50;
    // Parser pool: parse files in parallel off the main thread. Workers share this
    // process's Node runtime, so the native parser ABI always matches. Reads and
    // ALL SQLite writes stay on this coordinator thread — workers never touch the DB.
    const wantWorkers = options.workers ?? (0, parse_pool_1.defaultPoolSize)();
    const pool = wantWorkers > 0 ? new parse_pool_1.ParsePool(wantWorkers) : null;
    const workersUsed = pool && pool.usable ? wantWorkers : 0;
    let parseFailures = 0;
    const lookupExisting = db.prepare(`
    SELECT f.id, f.hash,
      (SELECT COUNT(*) FROM symbols s WHERE s.file_id = f.id) AS symbolCount,
      (SELECT COUNT(*) FROM blindspots b WHERE b.file_id = f.id) AS blindspotCount,
      (SELECT COUNT(*) FROM imports i WHERE i.from_file_id = f.id) AS importCount
    FROM files f WHERE f.path = ?
  `);
    try {
        for (let i = resumeStartIndex; i < files.length; i += BATCH_SIZE) {
            const remainingBudget = maxIndexFilesPerRun > 0 ? maxIndexFilesPerRun - processedThisRun : Number.POSITIVE_INFINITY;
            if (remainingBudget <= 0) {
                indexIncomplete = true;
                break;
            }
            const batch = files.slice(i, Math.min(i + BATCH_SIZE, i + remainingBudget));
            const jobs = [];
            for (const file of batch) {
                const existing = lookupExisting.get(file.path);
                let content;
                try {
                    content = fs_1.default.readFileSync(file.path, 'utf8');
                }
                catch {
                    parseFailures++;
                    currentFileCount++;
                    onProgress?.(currentFileCount, files.length);
                    continue;
                }
                const hash = crypto_1.default.createHash('sha256').update(content).digest('hex');
                const hasImportSyntax = /\bimport\s*(?:\(|[\s\w*{},]+from\s*['"]|['"])|\bexport\s+[\s\w*{},]+\s+from\s*['"]|\brequire\s*\(\s*['"]/.test(content);
                if (!options.force && existing && existing.hash === hash && (existing.symbolCount > 0 || existing.blindspotCount === 0) && (!hasImportSyntax || existing.importCount > 0)) {
                    touchIndexedAt.run(existing.id);
                    currentFileCount++;
                    onProgress?.(currentFileCount, files.length);
                    continue;
                }
                jobs.push({ file, fileId: existing ? existing.id : crypto_1.default.randomUUID(), content, hash, lines: content.split('\n').length, existing });
            }
            // ── Phase 2: parse in parallel (or sync if no pool) ────────────────────
            const parsed = pool
                ? await Promise.all(jobs.map((j) => pool.parse(j.file.path, j.content)))
                : jobs.map((j) => (0, parser_1.parseSource)(j.file.path, j.content));
            // ── Phase 3: embeddings + batched DB write (serial coordinator) ────────
            for (let k = 0; k < jobs.length; k++) {
                const j = jobs[k];
                const { symbols, callEdges, imports, blindspots, parserMode, parseQuality, languageName } = parsed[k];
                newlyIndexed++;
                const symbolData = [];
                for (const sym of symbols) {
                    const embedding = (0, embeddings_1.computeEmbedding)(sym.snippet);
                    symbolData.push({ sym, embedding: Buffer.from(embedding.buffer) });
                }
                db.transaction(() => {
                    insertFile.run({
                        id: j.fileId, path: j.file.path, lang: j.file.lang, size: j.file.size,
                        lines: j.lines, hash: j.hash, parser_mode: parserMode, parse_quality: parseQuality, language_name: languageName,
                    });
                    if (j.existing) {
                        deleteCallEdges.run(j.fileId);
                        deleteSymbols.run(j.fileId);
                        deleteBlindspots.run(j.fileId);
                        deleteImports.run(j.fileId);
                    }
                    for (const specifier of imports) {
                        insertImport.run({ id: crypto_1.default.randomUUID(), from_file_id: j.fileId, specifier });
                    }
                    for (const data of symbolData) {
                        const symId = crypto_1.default.randomUUID();
                        insertSymbol.run({ id: symId, name: data.sym.name, kind: data.sym.kind, file_id: j.fileId, line: data.sym.line, byte_start: data.sym.byteStart, byte_end: data.sym.byteEnd, snippet: data.sym.snippet });
                        insertEmbedding.run({ symbol_id: symId, embedding: data.embedding });
                        totalSymbols++;
                    }
                    for (const edge of callEdges) {
                        insertCallEdge.run({ id: crypto_1.default.randomUUID(), from_symbol: edge.fromSymbol || 'unknown', to_symbol: edge.toSymbolName, file_id: j.fileId });
                    }
                    for (const reason of blindspots) {
                        insertBlindspot.run({ id: crypto_1.default.randomUUID(), file_id: j.fileId, reason });
                        totalBlindspots++;
                    }
                })();
                currentFileCount++;
                onProgress?.(currentFileCount, files.length);
            }
            processedThisRun += batch.length;
            const nextCursor = Math.min(i + batch.length, files.length);
            (0, db_1.setIndexMeta)(db, 'index_resume_cursor', String(nextCursor));
            (0, db_1.setIndexMeta)(db, 'index_resume_processed_this_run', String(processedThisRun));
            if (nextCursor < files.length && maxIndexFilesPerRun > 0 && processedThisRun >= maxIndexFilesPerRun) {
                indexIncomplete = true;
            }
            // One yield per batch lets the SSE progress stream flush without per-file cost.
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (indexIncomplete)
                break;
        }
    }
    finally {
        if (pool)
            await pool.destroy();
    }
    // Record skipped (minified / generated / too-large) files as VISIBLE, typed
    // blindspots so coverage is fully accounted — a skipped file is never a hidden
    // gap. They appear in repo_map and blindspot_report with their reason.
    const recordSkipped = db.transaction(() => {
        for (const sk of scanResult.skipped) {
            const row = db.prepare(`SELECT id FROM files WHERE path = ?`).get(sk.path);
            const fileId = row ? row.id : crypto_1.default.randomUUID();
            insertFile.run({
                id: fileId, path: sk.path, lang: (sk.path.split('.').pop() || ''),
                size: sk.size, lines: 0, hash: `skipped:${sk.reason}`,
                parser_mode: 'skipped', parse_quality: 0, language_name: 'skipped',
            });
            db.prepare(`DELETE FROM blindspots WHERE file_id = ?`).run(fileId);
            const skReason = sk.reason === 'unsupported_ext'
                ? `skipped:unsupported_ext (${Math.round(sk.size / 1024)}KB) — no parser for this file type; represented as a stub so the agent can reach it without a raw read`
                : `skipped:${sk.reason} (${Math.round(sk.size / 1024)}KB) — not parsed; symbols would be noise`;
            insertBlindspot.run({ id: crypto_1.default.randomUUID(), file_id: fileId, reason: skReason });
            totalBlindspots++;
        }
    });
    recordSkipped();
    (0, db_1.resolveGraphEdges)(db);
    (0, db_1.refreshImportanceScores)(db);
    (0, db_1.refreshFileSignals)(db); // connectivity classes; must follow import resolution above
    (0, resolution_1.classifyResolution)(db, repoPath); // Zero Unknown Files ledger; must follow import resolution
    const totalFiles = db.prepare(`SELECT COUNT(*) as count FROM files`).get();
    // Persist index state so downstream tools (e.g. repair_plan) can refuse
    // destructive work on a partial index — "good enough to navigate, not to delete."
    const finalStopReason = indexIncomplete ? 'index_incomplete' : scanResult.stats.stopReason;
    const partialIndex = finalStopReason !== null;
    (0, db_1.setIndexMeta)(db, 'partial_index', partialIndex ? '1' : '0');
    (0, db_1.setIndexMeta)(db, 'scan_stop_reason', finalStopReason || '');
    (0, db_1.setIndexMeta)(db, 'files_indexed', String(newlyIndexed));
    (0, db_1.setIndexMeta)(db, 'index_resume_state', indexIncomplete ? 'in_progress' : 'complete');
    (0, db_1.setIndexMeta)(db, 'index_resume_cursor', indexIncomplete ? String(Math.min(resumeStartIndex + processedThisRun, files.length)) : String(files.length));
    (0, db_1.setIndexMeta)(db, 'index_resume_total', String(files.length));
    (0, db_1.setIndexMeta)(db, 'index_resume_fingerprint', fingerprint);
    // Persist excluded directories so reports can show them — exclusions are never silent.
    (0, db_1.setIndexMeta)(db, 'excluded_dirs', JSON.stringify(scanResult.stats.excludedDirs || []));
    db.close();
    const skippedByReason = scanResult.skipped.reduce((acc, s) => {
        acc[s.reason] = (acc[s.reason] || 0) + 1;
        return acc;
    }, {});
    const result = {
        scannedFiles: files.length,
        newlyIndexed,
        totalIndexedFiles: totalFiles.count,
        symbolsExtracted: totalSymbols,
        blindspotsDetected: totalBlindspots,
        staleRemoved: staleFiles.length,
        scanMs: scanResult.stats.scanMs,
        scanStopReason: finalStopReason,
        maxFilesHit: scanResult.stats.maxFilesHit,
        maxBytesHit: scanResult.stats.maxBytesHit,
        timeLimitHit: scanResult.stats.timeLimitHit,
        sourceBytesScanned: scanResult.stats.sourceBytes,
        skippedDirs: scanResult.stats.skippedDirs,
        skippedFiles: scanResult.stats.skippedFiles,
        generatedSkipped: scanResult.stats.generatedSkipped,
        filesSkippedFromParse: scanResult.skipped.length,
        skippedByReason,
        // Scale / honesty fields
        filesDiscovered: scanResult.stats.discoveredFiles,
        filesIndexed: newlyIndexed,
        minifiedSkipped: skippedByReason['minified'] || 0,
        largeFilesSkipped: skippedByReason['too_large'] || 0,
        parseFailures,
        workersUsed,
        // A scan/index that hit any guard did NOT see/write the whole repo.
        partialIndex,
        resume: {
            enabled: resumeEnabled,
            startedAt: resumeStartIndex,
            processedThisRun,
            nextCursor: indexIncomplete ? Math.min(resumeStartIndex + processedThisRun, files.length) : files.length,
            total: files.length,
            state: indexIncomplete ? 'in_progress' : 'complete',
        },
        archive: archive ? {
            source: archive.archivePath,
            extractedTo: archive.dir,
            filesExtracted: archive.filesExtracted,
            bytesExtracted: archive.bytesExtracted,
            extractStopReason: archive.stopReason || 'complete',
            entriesSkipped: archive.skipped.length,
            securityBlocked: archive.skipped.filter((s) => s.reason === 'path_traversal_blocked').length,
        } : null
    };
    try {
        (0, session_memory_1.appendMemoryEvent)(repoPath, {
            type: 'session.note',
            summary: `Index completed: ${totalFiles.count} files in index, stop reason ${finalStopReason || 'none'}.`,
            source: 'index_project',
            data: {
                subtype: 'index.completed',
                indexed_files: totalFiles.count,
                scanned_files: files.length,
                partial_index: partialIndex,
                scan_stop_reason: finalStopReason,
            },
        });
    }
    catch {
        // Indexing must not fail because local session memory failed.
    }
    return result;
}
async function indexSingleFile(repoPath, filePath) {
    const db = (0, db_1.initDb)(repoPath);
    if (!fs_1.default.existsSync(filePath)) {
        // Handle file deletion
        const existing = db.prepare(`SELECT id FROM files WHERE path = ?`).get(filePath);
        if (existing) {
            db.transaction(() => {
                db.prepare(`DELETE FROM call_edges WHERE file_id = ?`).run(existing.id);
                db.prepare(`DELETE FROM symbol_embeddings WHERE symbol_id IN (SELECT id FROM symbols WHERE file_id = ?)`).run(existing.id);
                db.prepare(`DELETE FROM symbols WHERE file_id = ?`).run(existing.id);
                db.prepare(`DELETE FROM blindspots WHERE file_id = ?`).run(existing.id);
                db.prepare(`DELETE FROM imports WHERE from_file_id = ?`).run(existing.id);
                db.prepare(`DELETE FROM files WHERE id = ?`).run(existing.id);
            })();
        }
        db.close();
        return;
    }
    const stat = fs_1.default.statSync(filePath);
    const ext = filePath.split('.').pop() || '';
    const content = fs_1.default.readFileSync(filePath, 'utf8');
    const hash = crypto_1.default.createHash('sha256').update(content).digest('hex');
    const existing = db.prepare(`SELECT id, hash FROM files WHERE path = ?`).get(filePath);
    if (existing && existing.hash === hash) {
        db.close();
        return; // No changes
    }
    const fileId = existing ? existing.id : crypto_1.default.randomUUID();
    const lines = content.split('\n').length;
    const { symbols, callEdges, imports, blindspots, parserMode, parseQuality, languageName } = (0, parser_1.parseSource)(filePath, content);
    const symbolData = [];
    for (const sym of symbols) {
        const embedding = (0, embeddings_1.computeEmbedding)(sym.snippet);
        symbolData.push({ sym, embedding: Buffer.from(embedding.buffer) });
    }
    db.transaction(() => {
        db.prepare(`
      INSERT INTO files (id, path, lang, size, lines, hash, parser_mode, parse_quality, language_name)
      VALUES (@id, @path, @lang, @size, @lines, @hash, @parser_mode, @parse_quality, @language_name)
      ON CONFLICT(path) DO UPDATE SET
        lang=excluded.lang,
        size=excluded.size,
        lines=excluded.lines,
        hash=excluded.hash,
        parser_mode=excluded.parser_mode,
        parse_quality=excluded.parse_quality,
        language_name=excluded.language_name,
        indexed_at=CURRENT_TIMESTAMP
    `).run({
            id: fileId,
            path: filePath,
            lang: ext,
            size: stat.size,
            lines,
            hash: hash,
            parser_mode: parserMode,
            parse_quality: parseQuality,
            language_name: languageName
        });
        if (existing) {
            db.prepare(`DELETE FROM call_edges WHERE file_id = ?`).run(fileId);
            db.prepare(`DELETE FROM symbol_embeddings WHERE symbol_id IN (SELECT id FROM symbols WHERE file_id = ?)`).run(fileId);
            db.prepare(`DELETE FROM symbols WHERE file_id = ?`).run(fileId);
            db.prepare(`DELETE FROM blindspots WHERE file_id = ?`).run(fileId);
            db.prepare(`DELETE FROM imports WHERE from_file_id = ?`).run(fileId);
        }
        const insertImport = db.prepare(`
      INSERT INTO imports (id, from_file_id, specifier)
      VALUES (@id, @from_file_id, @specifier)
    `);
        for (const specifier of imports) {
            insertImport.run({ id: crypto_1.default.randomUUID(), from_file_id: fileId, specifier });
        }
        const insertSymbol = db.prepare(`
      INSERT INTO symbols (id, name, kind, file_id, line, byte_start, byte_end, snippet)
      VALUES (@id, @name, @kind, @file_id, @line, @byte_start, @byte_end, @snippet)
    `);
        const insertEmbedding = db.prepare(`
      INSERT INTO symbol_embeddings (symbol_id, embedding)
      VALUES (@symbol_id, @embedding)
    `);
        for (const data of symbolData) {
            const symId = crypto_1.default.randomUUID();
            insertSymbol.run({
                id: symId,
                name: data.sym.name,
                kind: data.sym.kind,
                file_id: fileId,
                line: data.sym.line,
                byte_start: data.sym.byteStart,
                byte_end: data.sym.byteEnd,
                snippet: data.sym.snippet
            });
            insertEmbedding.run({
                symbol_id: symId,
                embedding: data.embedding
            });
        }
        const insertCallEdge = db.prepare(`
      INSERT INTO call_edges (id, from_symbol, to_symbol, file_id)
      VALUES (@id, @from_symbol, @to_symbol, @file_id)
    `);
        for (const edge of callEdges) {
            insertCallEdge.run({
                id: crypto_1.default.randomUUID(),
                from_symbol: edge.fromSymbol || 'unknown',
                to_symbol: edge.toSymbolName,
                file_id: fileId
            });
        }
        const insertBlindspot = db.prepare(`
      INSERT INTO blindspots (id, file_id, reason)
      VALUES (@id, @file_id, @reason)
    `);
        for (const reason of blindspots) {
            insertBlindspot.run({
                id: crypto_1.default.randomUUID(),
                file_id: fileId,
                reason
            });
        }
        (0, db_1.resolveGraphEdges)(db);
        (0, db_1.refreshImportanceScores)(db);
    })();
    (0, db_1.refreshFileSignals)(db);
    (0, resolution_1.classifyResolution)(db, repoPath);
    db.close();
}
