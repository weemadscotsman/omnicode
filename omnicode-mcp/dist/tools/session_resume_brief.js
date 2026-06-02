"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionResumeBrief = sessionResumeBrief;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const db_1 = require("../store/db");
const scanner_1 = require("../engine/scanner");
const repo_vision_gate_1 = require("../engine/repo_vision_gate");
const session_memory_1 = require("../engine/session_memory");
function readJsonIfExists(filePath) {
    try {
        if (!fs_1.default.existsSync(filePath))
            return null;
        return JSON.parse(fs_1.default.readFileSync(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function newestExisting(paths) {
    const existing = paths
        .filter((p) => fs_1.default.existsSync(p))
        .map((p) => ({ path: p, mtime: fs_1.default.statSync(p).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    return existing[0]?.path || null;
}
function rel(repoPath, filePath) {
    return filePath ? path_1.default.relative(repoPath, filePath) || filePath : null;
}
function safeGit(repoPath, args) {
    try {
        const out = (0, child_process_1.execFileSync)('git', args, {
            cwd: repoPath,
            encoding: 'utf8',
            timeout: 3000,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return out.trim() || null;
    }
    catch {
        return null;
    }
}
/**
 * Detect stack from common manifest files. Returns a short summary so an agent
 * can pick a target tool on the first call without a follow-up `config_map`.
 */
function detectStack(repoPath) {
    const manifests = [];
    const frameworks = [];
    const seen = new Set();
    const candidates = [
        'package.json',
        'tsconfig.json',
        'pyproject.toml',
        'requirements.txt',
        'Cargo.toml',
        'go.mod',
        'pom.xml',
        'build.gradle',
        'Gemfile',
        'composer.json',
        'pubspec.yaml',
        'mix.exs',
    ];
    for (const c of candidates) {
        const full = path_1.default.join(repoPath, c);
        if (fs_1.default.existsSync(full)) {
            manifests.push(c);
            seen.add(c);
        }
    }
    // Cheap framework signals from package.json
    const pkg = readJsonIfExists(path_1.default.join(repoPath, 'package.json'));
    if (pkg && pkg.dependencies) {
        const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        for (const f of ['next', 'nuxt', 'vue', 'react', 'angular', 'svelte', '@sveltejs/kit', 'express', 'fastify', 'nestjs', 'electron', 'tauri', '@modelcontextprotocol/sdk']) {
            if (all[f])
                frameworks.push(f);
        }
    }
    return { manifests, frameworks, primary_language: null };
}
/**
 * v0.2 god-tier: detect the current git branch + recent churn so the agent
 * starts with a sense of "where is this repo right now" before any other call.
 */
function gitContext(repoPath) {
    const branch = safeGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const lastCommit = safeGit(repoPath, ['log', '-1', '--pretty=%h %s']);
    let commits30d = null;
    try {
        const out = safeGit(repoPath, ['rev-list', '--count', '--since=30 days ago', 'HEAD']);
        commits30d = out === null ? 0 : parseInt(out, 10) || 0;
    }
    catch {
        commits30d = 0;
    }
    let topContrib = [];
    try {
        const out = safeGit(repoPath, [
            'shortlog', '-sn', '--since=30 days ago', 'HEAD', '--no-merges',
        ]);
        if (out) {
            topContrib = out
                .split('\n')
                .slice(0, 5)
                .map((l) => l.replace(/^\s*\d+\s+/, '').trim())
                .filter(Boolean);
        }
    }
    catch {
        topContrib = [];
    }
    return {
        branch: branch && branch !== 'HEAD' ? branch : null,
        last_commit: lastCommit,
        commits_30d: commits30d ?? 0,
        top_contributors_30d: topContrib,
    };
}
async function sessionResumeBrief(repoPath) {
    const resolved = path_1.default.resolve(repoPath);
    const name = path_1.default.basename(resolved);
    const hash = (0, session_memory_1.repoHash)(resolved);
    const db = (0, db_1.initDb)(resolved);
    try {
        const stats = (0, db_1.getIndexStats)(db);
        const gate = (0, repo_vision_gate_1.getRepoVisionGate)(db);
        const scanStopReason = (0, db_1.getIndexMeta)(db, 'scan_stop_reason') || 'unknown';
        const partialIndex = (0, db_1.getIndexMeta)(db, 'partial_index') === '1';
        const discovered = (0, scanner_1.estimateRawSourceStats)(resolved, { maxScanMs: 5000 });
        const memory = (0, session_memory_1.summarizeMemory)(resolved);
        const benchmarkJson = readJsonIfExists(path_1.default.join(resolved, '.omnicode', 'benchmark.json'));
        const handoffPath = memory.latestHandoff?.data?.path ||
            newestExisting([
                path_1.default.join(resolved, '.omnicode', 'NO_SPAGHETT_REPAIR_HANDOFF.md'),
                path_1.default.join(resolved, '.omnicode', 'NO_SPAGHETT_REPAIR_HANDOFF_TEST.md'),
            ]);
        const parserCoverage = db.prepare(`
      SELECT
        COALESCE(parser_mode, 'unknown') AS parser_mode,
        COALESCE(language_name, lang, 'unknown') AS language_name,
        COUNT(*) AS files,
        ROUND(AVG(parse_quality), 3) AS avg_quality
      FROM files
      GROUP BY parser_mode, language_name
      ORDER BY files DESC
      LIMIT 12
    `).all();
        const blockingBlindspots = db.prepare(`
      SELECT f.path, b.reason
      FROM blindspots b
      JOIN files f ON b.file_id = f.id
      WHERE b.reason LIKE '%|error|%'
         OR b.reason LIKE 'PARSE_FAILURE|%'
         OR b.reason LIKE 'UNSUPPORTED_EXTENSION|%'
         OR b.reason LIKE 'DYNAMIC_RUNTIME_REFERENCE|%'
         OR b.reason LIKE 'skipped:%'
      LIMIT 15
    `).all();
        const computedRiskyFiles = db.prepare(`
      SELECT f.path, f.parser_mode, f.parse_quality, COUNT(b.id) AS blindspots
      FROM files f
      LEFT JOIN blindspots b ON b.file_id = f.id
      WHERE f.parser_mode IN ('fallback', 'none', 'skipped') OR f.parse_quality < 0.6 OR b.id IS NOT NULL
      GROUP BY f.id
      ORDER BY blindspots DESC, f.parse_quality ASC
      LIMIT 10
    `).all();
        const computedSafeFiles = db.prepare(`
      SELECT path, parser_mode, parse_quality
      FROM files
      WHERE parser_mode = 'tree-sitter' AND parse_quality >= 0.9
      ORDER BY indexed_at DESC
      LIMIT 10
    `).all();
        // v0.2 god-tier additions: stack from the index, top symbols by importance,
        // and language byte breakdown so the agent sees "what is this codebase" at a
        // glance without a follow-up config_map call.
        const languageBreakdown = db.prepare(`
      SELECT
        COALESCE(language_name, 'unknown') AS language,
        COUNT(*) AS files,
        ROUND(SUM(COALESCE(parse_quality, 0)) * 1.0 / NULLIF(COUNT(*), 0), 3) AS avg_quality
      FROM files
      GROUP BY language_name
      ORDER BY files DESC
      LIMIT 12
    `).all();
        const topSymbols = db.prepare(`
      SELECT s.name, s.kind, f.path AS file_path, COALESCE(s.importance_score, 0) AS importance
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.kind IN ('function', 'method', 'class')
      ORDER BY importance DESC, s.name ASC
      LIMIT 10
    `).all();
        const stack = detectStack(resolved);
        if (languageBreakdown[0])
            stack.primary_language = languageBreakdown[0].language;
        const git = gitContext(resolved);
        const healthScore = gate.risk === 'LOW' ? 90 : gate.risk === 'MEDIUM' ? 65 : stats.files > 0 ? 35 : 0;
        const forbiddenActions = [
            'Do not read the full repo into model context.',
            partialIndex ? 'Do not delete, rename, or remove exports while index is partial.' : null,
            gate.destructiveAllowed ? null : 'Do not perform destructive repair without stronger repo vision.',
            gate.stats.dynamicRuntimeWarnings > 0 ? 'Do not edit dynamic/runtime reference files without runtime proof.' : null,
            gate.stats.unparsedFiles > 0 ? 'Do not treat unparsed files as dead code.' : null,
        ].filter(Boolean);
        let exactNextAction = 'Use repo_map or search_symbols for targeted work.';
        let recommendedTool = 'repo_map';
        if (stats.files === 0) {
            exactNextAction = 'Index the repository before analysis.';
            recommendedTool = 'index_project';
        }
        else if (partialIndex || gate.risk === 'HIGH') {
            exactNextAction = 'Inspect blindspots and avoid destructive actions.';
            recommendedTool = 'blindspot_report';
        }
        else if (!benchmarkJson && !memory.latestBenchmark) {
            exactNextAction = 'Run a benchmark to establish token-saving baseline.';
            recommendedTool = 'benchmark';
        }
        const brief = {
            repo: { name, path: resolved, hash },
            git: {
                branch: git.branch,
                last_commit: git.last_commit,
                commits_30d: git.commits_30d,
                top_contributors_30d: git.top_contributors_30d,
            },
            stack: {
                primary_language: stack.primary_language,
                manifests: stack.manifests,
                frameworks: stack.frameworks,
                language_breakdown: languageBreakdown,
            },
            top_symbols: topSymbols,
            indexed_state: {
                last_indexed_at: stats.indexed_at || null,
                indexed_files: stats.files,
                discovered_files: discovered.files,
                partial_index: partialIndex,
                scan_stop_reason: scanStopReason,
            },
            health: {
                score: healthScore,
                risk: gate.risk,
                summary: gate.reasons.length ? gate.reasons.join('; ') : 'no confidence blockers',
            },
            parser_coverage: parserCoverage,
            blindspots: {
                total: stats.blindspots,
                blocking: blockingBlindspots.length,
                blocking_examples: blockingBlindspots,
            },
            risky_files: memory.riskyFiles.length ? memory.riskyFiles : computedRiskyFiles,
            safe_files: memory.safeFiles.length ? memory.safeFiles : computedSafeFiles,
            latest_handoff_path: handoffPath,
            latest_handoff_relative: rel(resolved, handoffPath),
            memory_file: (0, session_memory_1.memoryFilePath)(resolved),
            last_benchmark_summary: memory.latestBenchmark?.data || (benchmarkJson ? {
                generated_at: benchmarkJson.generated_at,
                saving: benchmarkJson.cumulative?.saving_display,
                raw_tokens: benchmarkJson.raw?.raw_tokens_estimated,
                omnicode_tokens: benchmarkJson.cumulative?.omnicode_tokens,
            } : null),
            last_repair_state: memory.latestRepairRefusal || memory.latestRepairCompleted || null,
            known_user_decisions: memory.userDecisions,
            memory_event_counts: memory.byType,
            exact_next_action: exactNextAction,
            forbidden_actions: forbiddenActions,
            recommended_omnicode_tool: recommendedTool,
            brief_version: 'v0.2-god-tier',
        };
        return { result: JSON.stringify(brief, null, 2) };
    }
    finally {
        db.close();
    }
}
