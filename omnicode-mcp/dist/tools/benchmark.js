"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.benchmarkRepo = benchmarkRepo;
exports.renderBenchmarkMarkdown = renderBenchmarkMarkdown;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../store/db");
const scanner_1 = require("../engine/scanner");
const index_project_1 = require("./index_project");
const repo_map_1 = require("./repo_map");
const spaghetti_report_1 = require("./spaghetti_report");
const search_symbols_1 = require("./search_symbols");
const file_outline_1 = require("./file_outline");
const session_memory_1 = require("../engine/session_memory");
const resolution_1 = require("../engine/resolution");
function pctSave(baseline, omni) {
    if (baseline <= 0)
        return 0;
    return Math.max(0, ((baseline - omni) / baseline) * 100);
}
function displayPct(n) {
    // NO rounding to a marketing "99.9%". Full precision. The ground truth is the
    // exact integer token counts (baseline_tokens, omnicode_tokens) — the percentage
    // is derived from them and shown to 6 decimals so nothing is hidden.
    return `${n.toFixed(6)}%`;
}
// Byte-exact. BYTES are the measured ground truth (reproducible, model-agnostic).
// Tokens are a clearly-labeled derived ESTIMATE (bytes ÷ 4), never the headline.
function op(name, baselineBytes, payloadText, measurementType, notes = '') {
    const payloadBytes = Buffer.byteLength(payloadText || '', 'utf8'); // MEASURED
    const reduction = pctSave(baselineBytes, payloadBytes); // exact, unrounded
    return {
        operation: name,
        baseline_bytes: baselineBytes, // MEASURED (sum of file sizes)
        payload_bytes: payloadBytes, // MEASURED (utf-8 byte length)
        reduction_percent: reduction, // exact ratio of measured bytes
        reduction_display: displayPct(reduction),
        baseline_tokens_estimated: Math.ceil(baselineBytes / 4), // ESTIMATE, labeled
        payload_tokens_estimated: Math.ceil(payloadBytes / 4), // ESTIMATE, labeled
        measurement: 'exact_bytes',
        measurement_type: measurementType,
        formula: '(baseline_bytes - payload_bytes) / baseline_bytes',
        notes,
    };
}
function skippedOp(name, reason) {
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
function ensureDir(dir) {
    fs_1.default.mkdirSync(dir, { recursive: true });
}
async function benchmarkRepo(repoPath, options = {}) {
    const started = Date.now();
    const scanOptions = {
        maxFiles: options.max_files,
        maxBytes: options.max_bytes,
        maxScanMs: options.max_scan_ms,
    };
    const raw = (0, scanner_1.estimateRawSourceStats)(repoPath, scanOptions);
    const indexResult = await (0, index_project_1.indexProject)(repoPath, undefined, scanOptions);
    const indexText = JSON.stringify(indexResult, null, 2);
    const map = await (0, repo_map_1.repoMap)(repoPath);
    const spaghetti = await (0, spaghetti_report_1.spaghettiReport)(repoPath);
    const query = options.query || 'app';
    const search = await (0, search_symbols_1.searchSymbols)(repoPath, query, 10, 0.4);
    const db = (0, db_1.initDb)(repoPath);
    const largestRawFile = db.prepare(`SELECT path, size, parser_mode FROM files ORDER BY size DESC LIMIT 1`).get();
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
  `).get();
    let outlineText = '';
    if (firstFile) {
        outlineText = (await (0, file_outline_1.fileOutline)(repoPath, firstFile.path)).result;
    }
    // MEASURED ground truth: exact source bytes (sum of file sizes) and the largest
    // file's exact byte size. Every baseline below is a measured quantity — no models.
    const rawBytes = raw.bytes;
    const firstFileBytes = firstFile ? (fs_1.default.statSync(firstFile.path).size || 0) : 0;
    const operations = [
        op('index', rawBytes, indexText, 'measured_payload_bytes_vs_measured_source_bytes', 'Index output payload measured. Indexing compute is not a model-token cost.'),
        op('repo_map', rawBytes, map.result, 'measured_payload_bytes_vs_measured_source_bytes'),
        firstFile
            ? op('file_outline', firstFileBytes, outlineText, 'measured_payload_bytes_vs_measured_parseable_source_file_bytes', `Selector: largest parseable source/test/route file with symbols (${path_1.default.relative(repoPath, firstFile.path)}).`)
            : skippedOp('file_outline', 'file_outline_skipped:no_parseable_source_file'),
        op('search_symbols', rawBytes, search.result, 'measured_payload_bytes_vs_measured_source_bytes'),
        op('spaghetti_report', rawBytes, spaghetti.result, 'measured_payload_bytes_vs_measured_source_bytes', 'Baseline = full source bytes (the alternative to a graph review is reading the source).'),
    ];
    const includedOps = operations.filter((x) => !x.skipped);
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
  `).get();
    const resolution = (0, resolution_1.getResolutionCoverage)(db);
    db.close();
    const blindspotRate = stats.indexed_files > 0 ? stats.blindspots / stats.indexed_files : 0;
    const result = {
        benchmark_version: '2.0.0',
        generated_at: new Date().toISOString(),
        repo_path: repoPath,
        raw: {
            discovered_source_files: raw.files,
            raw_bytes: raw.bytes, // MEASURED
            raw_tokens_estimated: raw.tokens, // ESTIMATE (raw_bytes ÷ 4), labeled
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
            baseline_bytes: cumulativeBaselineBytes, // MEASURED
            payload_bytes: cumulativePayloadBytes, // MEASURED
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
            largestRawFile && largestRawFile.parser_mode === 'skipped' ? `largest_file_skipped_artifact:${path_1.default.relative(repoPath, largestRawFile.path)}:${largestRawFile.size}` : null,
            firstFile ? 'file_outline_selector:source_only' : 'file_outline_skipped:no_parseable_source',
        ].filter(Boolean),
        elapsed_ms: Date.now() - started,
    };
    if (options.write !== false) {
        const outDir = path_1.default.join(repoPath, '.omnicode');
        ensureDir(outDir);
        fs_1.default.writeFileSync(path_1.default.join(outDir, 'benchmark.json'), JSON.stringify(result, null, 2), 'utf8');
        fs_1.default.writeFileSync(path_1.default.join(outDir, 'BENCHMARK.md'), renderBenchmarkMarkdown(result), 'utf8');
    }
    try {
        (0, session_memory_1.appendMemoryEvent)(repoPath, {
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
    }
    catch {
        // Benchmark output is authoritative; memory is a best-effort session aid.
    }
    return result;
}
function renderBenchmarkMarkdown(result) {
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
        ...result.operations.map((x) => `| ${x.operation} | ${x.baseline_bytes} | ${x.payload_bytes} | ${x.reduction_display} | ${x.measurement_type} |`),
        '',
        `Cumulative (MEASURED bytes): ${result.cumulative.baseline_bytes} → ${result.cumulative.payload_bytes} bytes = ${result.cumulative.reduction_display} reduction.`,
        `Warm query average payload: ${result.cumulative.warm_query_average_bytes} bytes (~${Math.ceil(result.cumulative.warm_query_average_bytes / 4)} est. tokens).`,
        '',
        result.anomalies.length ? `## Anomalies\n${result.anomalies.map((a) => `- ${a}`).join('\n')}` : '## Anomalies\nNone.',
        '',
        'Measurement: BYTES are exact (file sizes + utf-8 payload byte length) — the ground-truth reduction. Token counts are a labeled estimate (bytes ÷ 4), never the headline. All baselines are measured; no modeled ratios.',
    ];
    return lines.join('\n');
}
