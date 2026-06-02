import { initDb, resolveGraphEdges, refreshImportanceScores, refreshFileSignals, setIndexMeta, getIndexMeta } from '../store/db';
import { ScanOptions, scanRepositoryWithStats } from '../engine/scanner';
import { parseSource } from '../engine/parser';
import { ParsePool, defaultPoolSize } from '../engine/parse_pool';
import { computeEmbedding } from '../engine/embeddings';
import { assertIndexableRoot } from '../security/sandbox';
import { appendMemoryEvent } from '../engine/session_memory';
import { classifyResolution } from '../engine/resolution';
import { mergeConfigOptions, resolveConfiguredRepoPath } from '../engine/config';
import { isArchivePath, extractArchive, ExtractedArchive } from '../engine/archive_loader';
import fs from 'fs';
import crypto from 'crypto';

export interface IndexOptions extends ScanOptions {
  workers?: number; // 0 forces synchronous parsing; undefined = auto (cpu-1, max 8)
  force?: boolean;  // re-parse every file even if unchanged (after a parser/engine upgrade)
  resume?: boolean; // default true; continue an interrupted/chunked index when the scan fingerprint matches
  maxIndexFilesPerRun?: number; // test/ops escape hatch: process only N source candidates, then checkpoint
}

function indexFingerprint(files: Array<{ path: string; size: number }>) {
  const h = crypto.createHash('sha256');
  for (const file of files) h.update(file.path).update('\0').update(String(file.size)).update('\n');
  return h.digest('hex');
}

export async function indexProject(repoPath: string, onProgress?: (current: number, total: number) => void, options: IndexOptions = {}) {
  repoPath = resolveConfiguredRepoPath(repoPath);

  // Archive ingestion: a .zip/.cbz/.epub/.jar is streamed to a temp dir (hardened
  // against zip-slip + zip-bomb), then indexed like any directory. The index is
  // keyed by the extracted dir; callers query that path.
  let archive: ExtractedArchive | null = null;
  if (isArchivePath(repoPath)) {
    archive = await extractArchive(repoPath, options);
    repoPath = archive.dir;
  }

  options = mergeConfigOptions(repoPath, options) as IndexOptions;
  // Refuse drive roots, UNC share roots, and system/home dirs before touching disk.
  assertIndexableRoot(repoPath);
  const db = initDb(repoPath);
  
  const scanResult = scanRepositoryWithStats(repoPath, options);
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
  const previousFingerprint = getIndexMeta(db, 'index_resume_fingerprint');
  const previousState = getIndexMeta(db, 'index_resume_state');
  const previousCursor = Number(getIndexMeta(db, 'index_resume_cursor') || '0');
  const resumeStartIndex = resumeEnabled && previousState === 'in_progress' && previousFingerprint === fingerprint
    ? Math.max(0, Math.min(previousCursor, files.length))
    : 0;
  const maxIndexFilesPerRun = Math.max(0, Number(options.maxIndexFilesPerRun ?? process.env.OMNICODE_INDEX_MAX_FILES_PER_RUN ?? 0));
  currentFileCount = resumeStartIndex;

  setIndexMeta(db, 'index_resume_state', files.length > 0 ? 'in_progress' : 'complete');
  setIndexMeta(db, 'index_resume_fingerprint', fingerprint);
  setIndexMeta(db, 'index_resume_cursor', String(resumeStartIndex));
  setIndexMeta(db, 'index_resume_total', String(files.length));

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

  const existingFiles = db.prepare(`SELECT id, path FROM files`).all() as Array<{ id: string; path: string }>;
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
  const wantWorkers = options.workers ?? defaultPoolSize();
  const pool = wantWorkers > 0 ? new ParsePool(wantWorkers) : null;
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

      // ── Phase 1: read + incremental skip-check (main thread) ───────────────
      type Job = { file: typeof batch[number]; fileId: string; content: string; hash: string; lines: number; existing: any };
      const jobs: Job[] = [];
      for (const file of batch) {
        const existing = lookupExisting.get(file.path) as
          { id: string, hash: string, symbolCount: number, blindspotCount: number, importCount: number } | undefined;
        let content: string;
        try { content = fs.readFileSync(file.path, 'utf8'); }
        catch { parseFailures++; currentFileCount++; onProgress?.(currentFileCount, files.length); continue; }
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        const hasImportSyntax = /\bimport\s*(?:\(|[\s\w*{},]+from\s*['"]|['"])|\bexport\s+[\s\w*{},]+\s+from\s*['"]|\brequire\s*\(\s*['"]/.test(content);
        if (!options.force && existing && existing.hash === hash && (existing.symbolCount > 0 || existing.blindspotCount === 0) && (!hasImportSyntax || existing.importCount > 0)) {
          touchIndexedAt.run(existing.id);
          currentFileCount++;
          onProgress?.(currentFileCount, files.length);
          continue;
        }
        jobs.push({ file, fileId: existing ? existing.id : crypto.randomUUID(), content, hash, lines: content.split('\n').length, existing });
      }

      // ── Phase 2: parse in parallel (or sync if no pool) ────────────────────
      const parsed = pool
        ? await Promise.all(jobs.map((j) => pool.parse(j.file.path, j.content)))
        : jobs.map((j) => parseSource(j.file.path, j.content));

      // ── Phase 3: embeddings + batched DB write (serial coordinator) ────────
      for (let k = 0; k < jobs.length; k++) {
        const j = jobs[k];
        const { symbols, callEdges, imports, blindspots, parserMode, parseQuality, languageName } = parsed[k];
        newlyIndexed++;

        const symbolData: { sym: any; embedding: Buffer }[] = [];
        for (const sym of symbols) {
          const embedding = computeEmbedding(sym.snippet);
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
            insertImport.run({ id: crypto.randomUUID(), from_file_id: j.fileId, specifier });
          }
          for (const data of symbolData) {
            const symId = crypto.randomUUID();
            insertSymbol.run({ id: symId, name: data.sym.name, kind: data.sym.kind, file_id: j.fileId, line: data.sym.line, byte_start: data.sym.byteStart, byte_end: data.sym.byteEnd, snippet: data.sym.snippet });
            insertEmbedding.run({ symbol_id: symId, embedding: data.embedding });
            totalSymbols++;
          }
          for (const edge of callEdges) {
            insertCallEdge.run({ id: crypto.randomUUID(), from_symbol: edge.fromSymbol || 'unknown', to_symbol: edge.toSymbolName, file_id: j.fileId });
          }
          for (const reason of blindspots) {
            insertBlindspot.run({ id: crypto.randomUUID(), file_id: j.fileId, reason });
            totalBlindspots++;
          }
        })();

        currentFileCount++;
        onProgress?.(currentFileCount, files.length);
      }
      processedThisRun += batch.length;
      const nextCursor = Math.min(i + batch.length, files.length);
      setIndexMeta(db, 'index_resume_cursor', String(nextCursor));
      setIndexMeta(db, 'index_resume_processed_this_run', String(processedThisRun));
      if (nextCursor < files.length && maxIndexFilesPerRun > 0 && processedThisRun >= maxIndexFilesPerRun) {
        indexIncomplete = true;
      }
      // One yield per batch lets the SSE progress stream flush without per-file cost.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (indexIncomplete) break;
    }
  } finally {
    if (pool) await pool.destroy();
  }

  // Record skipped (minified / generated / too-large) files as VISIBLE, typed
  // blindspots so coverage is fully accounted — a skipped file is never a hidden
  // gap. They appear in repo_map and blindspot_report with their reason.
  const recordSkipped = db.transaction(() => {
    for (const sk of scanResult.skipped) {
      const row = db.prepare(`SELECT id FROM files WHERE path = ?`).get(sk.path) as { id: string } | undefined;
      const fileId = row ? row.id : crypto.randomUUID();
      insertFile.run({
        id: fileId, path: sk.path, lang: (sk.path.split('.').pop() || ''),
        size: sk.size, lines: 0, hash: `skipped:${sk.reason}`,
        parser_mode: 'skipped', parse_quality: 0, language_name: 'skipped',
      });
      db.prepare(`DELETE FROM blindspots WHERE file_id = ?`).run(fileId);
      const skReason = sk.reason === 'unsupported_ext'
        ? `skipped:unsupported_ext (${Math.round(sk.size / 1024)}KB) — no parser for this file type; represented as a stub so the agent can reach it without a raw read`
        : `skipped:${sk.reason} (${Math.round(sk.size / 1024)}KB) — not parsed; symbols would be noise`;
      insertBlindspot.run({ id: crypto.randomUUID(), file_id: fileId, reason: skReason });
      totalBlindspots++;
    }
  });
  recordSkipped();

  resolveGraphEdges(db);
  refreshImportanceScores(db);
  refreshFileSignals(db); // connectivity classes; must follow import resolution above
  classifyResolution(db, repoPath); // Zero Unknown Files ledger; must follow import resolution

  const totalFiles = db.prepare(`SELECT COUNT(*) as count FROM files`).get() as { count: number };

  // Persist index state so downstream tools (e.g. repair_plan) can refuse
  // destructive work on a partial index — "good enough to navigate, not to delete."
  const finalStopReason = indexIncomplete ? 'index_incomplete' : scanResult.stats.stopReason;
  const partialIndex = finalStopReason !== null;
  setIndexMeta(db, 'partial_index', partialIndex ? '1' : '0');
  setIndexMeta(db, 'scan_stop_reason', finalStopReason || '');
  setIndexMeta(db, 'files_indexed', String(newlyIndexed));
  setIndexMeta(db, 'index_resume_state', indexIncomplete ? 'in_progress' : 'complete');
  setIndexMeta(db, 'index_resume_cursor', indexIncomplete ? String(Math.min(resumeStartIndex + processedThisRun, files.length)) : String(files.length));
  setIndexMeta(db, 'index_resume_total', String(files.length));
  setIndexMeta(db, 'index_resume_fingerprint', fingerprint);
  // Persist excluded directories so reports can show them — exclusions are never silent.
  setIndexMeta(db, 'excluded_dirs', JSON.stringify(scanResult.stats.excludedDirs || []));

  db.close();

  const skippedByReason = scanResult.skipped.reduce((acc, s) => {
    acc[s.reason] = (acc[s.reason] || 0) + 1; return acc;
  }, {} as Record<string, number>);

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
    appendMemoryEvent(repoPath, {
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
  } catch {
    // Indexing must not fail because local session memory failed.
  }
  return result;
}

export async function indexSingleFile(repoPath: string, filePath: string) {
  const db = initDb(repoPath);
  
  if (!fs.existsSync(filePath)) {
    // Handle file deletion
    const existing = db.prepare(`SELECT id FROM files WHERE path = ?`).get(filePath) as { id: string } | undefined;
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

  const stat = fs.statSync(filePath);
  const ext = filePath.split('.').pop() || '';
  const content = fs.readFileSync(filePath, 'utf8');
  const hash = crypto.createHash('sha256').update(content).digest('hex');

  const existing = db.prepare(`SELECT id, hash FROM files WHERE path = ?`).get(filePath) as { id: string, hash: string } | undefined;
  if (existing && existing.hash === hash) {
    db.close();
    return; // No changes
  }

  const fileId = existing ? existing.id : crypto.randomUUID();
  const lines = content.split('\n').length;
  
  const { symbols, callEdges, imports, blindspots, parserMode, parseQuality, languageName } = parseSource(filePath, content);

  const symbolData: { sym: any; embedding: Buffer }[] = [];
  for (const sym of symbols) {
     const embedding = computeEmbedding(sym.snippet);
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
      insertImport.run({ id: crypto.randomUUID(), from_file_id: fileId, specifier });
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
      const symId = crypto.randomUUID();
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
        id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
        file_id: fileId,
        reason
      });
    }

    resolveGraphEdges(db);
    refreshImportanceScores(db);
  })();
  refreshFileSignals(db);
  classifyResolution(db, repoPath);
  db.close();
}
