import fs from 'fs';
import path from 'path';
import { initDb } from '../store/db';
import { estimateRawSourceStats } from '../engine/scanner';
import { indexProject } from './index_project';
import { repoMap } from './repo_map';
import { spaghettiReport } from './spaghetti_report';
import { searchSymbols } from './search_symbols';
import { fileOutline } from './file_outline';
import { appendMemoryEvent } from '../engine/session_memory';
import { getResolutionCoverage } from '../engine/resolution';

export interface BenchmarkOptions {
  max_files?: number;
  max_bytes?: number;
  max_scan_ms?: number;
  query?: string;
  write?: boolean;
}

function pctSave(baseline: number, omni: number): number {
  if (baseline <= 0) return 0;
  return Math.max(0, ((baseline - omni) / baseline) * 100);
}

function displayPct(n: number): string {
  // NO rounding to a marketing "99.9%". Full precision. The ground truth is the
  // exact integer token counts (baseline_tokens, omnicode_tokens) — the percentage
  // is derived from them and shown to 6 decimals so nothing is hidden.
  return `${n.toFixed(6)}%`;
}

// Byte-exact. BYTES are the measured ground truth (reproducible, model-agnostic).
// Tokens are a clearly-labeled derived ESTIMATE (bytes ÷ 4), never the headline.
function op(name: string, baselineBytes: number, payloadText: string, measurementType: string, notes = '') {
  const payloadBytes = Buffer.byteLength(payloadText || '', 'utf8'); // MEASURED
  const reduction = pctSave(baselineBytes, payloadBytes);            // exact, unrounded
  return {
    operation: name,
    baseline_bytes: baselineBytes,                    // MEASURED (sum of file sizes)
    payload_bytes: payloadBytes,                      // MEASURED (utf-8 byte length)
    reduction_percent: reduction,                     // exact ratio of measured bytes
    reduction_display: displayPct(reduction),
    baseline_tokens_estimated: Math.ceil(baselineBytes / 4), // ESTIMATE, labeled
    payload_tokens_estimated: Math.ceil(payloadBytes / 4),   // ESTIMATE, labeled
    measurement: 'exact_bytes',
    measurement_type: measurementType,
    formula: '(baseline_bytes - payload_bytes) / baseline_bytes',
    notes,
  };
}

function skippedOp(name: string, reason: string) {
  return {
    operation: name,
    baseline_bytes: 0,
    payload_bytes: 0,
    reduction_percent: 0,
    reduction_display: 'skipped',
    baseline_tokens_estimated: 0,
    payload_tokens_estimated: 0,
    measurement: 'skipped',
    measurement_type: 'skipped',
    formula: 'n/a',
    notes: reason,
    skipped: true,
    skip_reason: reason,
  };
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export async function benchmarkRepo(repoPath: string, options: BenchmarkOptions = {}) {
  const started = Date.now();
  const scanOptions = {
    maxFiles: options.max_files,
    maxBytes: options.max_bytes,
    maxScanMs: options.max_scan_ms,
  };

  const raw = estimateRawSourceStats(repoPath, scanOptions);
  const indexResult = await indexProject(repoPath, undefined, scanOptions);
  const indexText = JSON.stringify(indexResult, null, 2);

  const map = await repoMap(repoPath);
  const spaghetti = await spaghettiReport(repoPath);
  const query = options.query || 'app';
  const search = await searchSymbols(repoPath, query, 10, 0.4);

  const db = initDb(repoPath);
  const largestRawFile = db.prepare(`SELECT path, size, parser_mode FROM files ORDER BY size DESC LIMIT 1`).get() as
    { path: string; size: number; parser_mode: string } | undefined;
  const firstFile = db.prepare(`
    SELECT f.path, f.size
    FROM files f
    JOIN resolution r ON r.file_id = f.id
    WHERE r.state IN ('resolved_full', 'resolved_partial')
      AND r.kind IN ('source', 'test', 'route')
      AND f.parser_mode IS NOT NULL
      AND f.parser_mode NOT IN ('none', 'skipped', 'unknown')
      AND LOWER(f.path) NOT GLOB '*.zip'
      AND LOWER(f.path) NOT GLOB '*.tar'
      AND LOWER(f.path) NOT GLOB '*.gz'
      AND LOWER(f.path) NOT GLOB '*.rar'
      AND LOWER(f.path) NOT GLOB '*.7z'
      AND LOWER(f.path) NOT GLOB '*.mp4'
      AND LOWER(f.path) NOT GLOB '*.mp3'
      AND LOWER(f.path) NOT GLOB '*.png'
      AND LOWER(f.path) NOT GLOB '*.jpg'
      AND LOWER(f.path) NOT GLOB '*.jpeg'
      AND LOWER(f.path) NOT GLOB '*.webp'
      AND LOWER(f.path) NOT GLOB '*.exe'
      AND LOWER(f.path) NOT GLOB '*.dll'
      AND LOWER(f.path) NOT GLOB '*.bin'
      AND EXISTS (SELECT 1 FROM symbols s WHERE s.file_id = f.id)
    ORDER BY f.size DESC
    LIMIT 1
  `).get() as { path: string; size: number } | undefined;
  let outlineText = '';
  if (firstFile) {
    outlineText = (await fileOutline(repoPath, firstFile.path)).result;
  }

  // MEASURED ground truth: exact source bytes (sum of file sizes) and the largest
  // file's exact byte size. Every baseline below is a measured quantity — no models.
  const rawBytes = raw.bytes;
  const firstFileBytes = firstFile ? (fs.statSync(firstFile.path).size || 0) : 0;
  const operations = [
    op('index', rawBytes, indexText, 'measured_payload_bytes_vs_measured_source_bytes', 'Index output payload measured. Indexing compute is not a model-token cost.'),
    op('repo_map', rawBytes, map.result, 'measured_payload_bytes_vs_measured_source_bytes'),
    firstFile
      ? op('file_outline', firstFileBytes, outlineText, 'measured_payload_bytes_vs_measured_parseable_source_file_bytes', `Selector: largest parseable source/test/route file with symbols (${path.relative(repoPath, firstFile.path)}).`)
      : skippedOp('file_outline', 'file_outline_skipped:no_parseable_source_file'),
    op('search_symbols', rawBytes, search.result, 'measured_payload_bytes_vs_measured_source_bytes'),
    op('spaghetti_report', rawBytes, spaghetti.result, 'measured_payload_bytes_vs_measured_source_bytes', 'Baseline = full source bytes (the alternative to a graph review is reading the source).'),
  ];

  const includedOps = operations.filter((x: any) => !x.skipped);
  const cumulativeBaselineBytes = includedOps.reduce((a, x) => a + x.baseline_bytes, 0);
  const cumulativePayloadBytes = includedOps.reduce((a, x) => a + x.payload_bytes, 0);
  const warmOps = includedOps.filter((x) => x.operation !== 'index');
  const warmAvgBytes = warmOps.length ? Math.round(warmOps.reduce((a, x) => a + x.payload_bytes, 0) / warmOps.length) : 0;
  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM files) AS indexed_files,
      (SELECT COUNT(*) FROM symbols) AS symbols,
      (SELECT COUNT(*) FROM edges) AS edges,
      (SELECT COUNT(*) FROM blindspots) AS blindspots
  `).get() as { indexed_files: number; symbols: number; edges: number; blindspots: number };
  const resolution = getResolutionCoverage(db);
  db.close();
  const blindspotRate = stats.indexed_files > 0 ? stats.blindspots / stats.indexed_files : 0;

  const result = {
    benchmark_version: '2.0.0',
    generated_at: new Date().toISOString(),
    repo_path: repoPath,
    raw: {
      discovered_source_files: raw.files,
      raw_bytes: raw.bytes,                       // MEASURED
      raw_tokens_estimated: raw.tokens,           // ESTIMATE (raw_bytes ÷ 4), labeled
      scanner: raw.stats,
    },
    index: {
      ...indexResult,
      indexed_files: stats.indexed_files,
      symbols: stats.symbols,
      graph_edges: stats.edges,
      blindspots: stats.blindspots,
      blindspot_rate: Number(blindspotRate.toFixed(4)),
    },
    // Pro headline: resolution coverage, not a vague blindspot rate. Every file
    // accounted for; source understood as deeply as possible; gaps named.
    resolution: {
      files_accounted: resolution.total,
      unknown_files: resolution.unknown,
      source_files: resolution.sourceFiles,
      source_resolution_coverage: Number((resolution.sourceResolutionCoverage * 100).toFixed(2)),
      unresolved_source_files: resolution.unresolvedSource,
      runtime_required_files: resolution.runtimeRequired,
      artifacts_classified: resolution.artifactsClassified,
      blocking_repair_gaps: resolution.blockingRepairGaps,
      by_state: resolution.byState,
    },
    operations,
    cumulative: {
      baseline_bytes: cumulativeBaselineBytes,                       // MEASURED
      payload_bytes: cumulativePayloadBytes,                         // MEASURED
      reduction_percent: pctSave(cumulativeBaselineBytes, cumulativePayloadBytes), // exact
      reduction_display: displayPct(pctSave(cumulativeBaselineBytes, cumulativePayloadBytes)),
      baseline_tokens_estimated: Math.ceil(cumulativeBaselineBytes / 4),
      payload_tokens_estimated: Math.ceil(cumulativePayloadBytes / 4),
      warm_query_average_bytes: warmAvgBytes,
    },
    anomalies: [
      indexResult.scanStopReason ? `scan_stop:${indexResult.scanStopReason}` : null,
      blindspotRate > 0.1 ? `high_blindspot_rate:${(blindspotRate * 100).toFixed(1)}%` : null,
      indexResult.timeLimitHit ? 'time_limit_hit' : null,
      indexResult.maxFilesHit ? 'max_files_hit' : null,
      indexResult.maxBytesHit ? 'max_bytes_hit' : null,
      largestRawFile && largestRawFile.parser_mode === 'skipped' ? `largest_file_skipped_artifact:${path.relative(repoPath, largestRawFile.path)}:${largestRawFile.size}` : null,
      firstFile ? 'file_outline_selector:source_only' : 'file_outline_skipped:no_parseable_source',
    ].filter(Boolean),
    elapsed_ms: Date.now() - started,
  };

  if (options.write !== false) {
    const outDir = path.join(repoPath, '.omnicode');
    ensureDir(outDir);
    fs.writeFileSync(path.join(outDir, 'benchmark.json'), JSON.stringify(result, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'BENCHMARK.md'), renderBenchmarkMarkdown(result), 'utf8');
  }

  try {
    appendMemoryEvent(repoPath, {
      type: 'benchmark.completed',
      summary: `Benchmark completed: ${result.cumulative.reduction_display} byte reduction across ${result.operations.length} operations.`,
      source: 'benchmark',
      data: {
        generated_at: result.generated_at,
        reduction: result.cumulative.reduction_display,
        raw_bytes: result.raw.raw_bytes,
        payload_bytes: result.cumulative.payload_bytes,
        indexed_files: result.index.indexed_files,
        blindspots: result.index.blindspots,
        anomalies: result.anomalies,
      },
    });
  } catch {
    // Benchmark output is authoritative; memory is a best-effort session aid.
  }

  return result;
}

export function renderBenchmarkMarkdown(result: any): string {
  const lines = [
    `# OmniCode Benchmark v${result.benchmark_version}`,
    '',
    `Repo: ${result.repo_path}`,
    `Generated: ${result.generated_at}`,
    '',
    `Source bytes (MEASURED): ${result.raw.raw_bytes} · Files: ${result.raw.discovered_source_files} · est. tokens (bytes÷4): ${result.raw.raw_tokens_estimated}`,
    `Indexed: ${result.index.indexed_files} files · Symbols: ${result.index.symbols} · Edges: ${result.index.graph_edges} · Blindspots: ${result.index.blindspots}`,
    result.resolution
      ? `Resolution: ${result.resolution.source_files === 0 ? 'n/a (no source files)' : result.resolution.source_resolution_coverage + '% source coverage'} · ${result.resolution.files_accounted} files accounted · ${result.resolution.unknown_files} unknown · ${result.resolution.blocking_repair_gaps} blocking gaps`
      : '',
    '',
    '| Operation | Baseline bytes | Payload bytes | Reduction | Measurement |',
    '|---|---:|---:|---:|---|',
    ...result.operations.map((x: any) => `| ${x.operation} | ${x.baseline_bytes} | ${x.payload_bytes} | ${x.reduction_display} | ${x.measurement_type} |`),
    '',
    `Cumulative (MEASURED bytes): ${result.cumulative.baseline_bytes} → ${result.cumulative.payload_bytes} bytes = ${result.cumulative.reduction_display} reduction.`,
    `Warm query average payload: ${result.cumulative.warm_query_average_bytes} bytes (~${Math.ceil(result.cumulative.warm_query_average_bytes / 4)} est. tokens).`,
    '',
    result.anomalies.length ? `## Anomalies\n${result.anomalies.map((a: string) => `- ${a}`).join('\n')}` : '## Anomalies\nNone.',
    '',
    'Measurement: BYTES are exact (file sizes + utf-8 payload byte length) — the ground-truth reduction. Token counts are a labeled estimate (bytes ÷ 4), never the headline. All baselines are measured; no modeled ratios.',
  ];
  return lines.join('\n');
}
