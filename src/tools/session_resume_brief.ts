import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { initDb, getIndexMeta, getIndexStats } from '../store/db';
import { estimateRawSourceStats } from '../engine/scanner';
import { getRepoVisionGate } from '../engine/repo_vision_gate';
import { repoHash, summarizeMemory, memoryFilePath } from '../engine/session_memory';

function readJsonIfExists(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function newestExisting(paths: string[]): string | null {
  const existing = paths
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ path: p, mtime: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return existing[0]?.path || null;
}

function rel(repoPath: string, filePath: string | null) {
  return filePath ? path.relative(repoPath, filePath) || filePath : null;
}

function safeGit(repoPath: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Detect stack from common manifest files. Returns a short summary so an agent
 * can pick a target tool on the first call without a follow-up `config_map`.
 */
function detectStack(repoPath: string): { manifests: string[]; frameworks: string[]; primary_language: string | null } {
  const manifests: string[] = [];
  const frameworks: string[] = [];
  const seen = new Set<string>();
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
    const full = path.join(repoPath, c);
    if (fs.existsSync(full)) {
      manifests.push(c);
      seen.add(c);
    }
  }
  // Cheap framework signals from package.json
  const pkg = readJsonIfExists(path.join(repoPath, 'package.json'));
  if (pkg && pkg.dependencies) {
    const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const f of ['next', 'nuxt', 'vue', 'react', 'angular', 'svelte', '@sveltejs/kit', 'express', 'fastify', 'nestjs', 'electron', 'tauri', '@modelcontextprotocol/sdk']) {
      if (all[f]) frameworks.push(f);
    }
  }
  return { manifests, frameworks, primary_language: null };
}

/**
 * v0.2 god-tier: detect the current git branch + recent churn so the agent
 * starts with a sense of "where is this repo right now" before any other call.
 */
function gitContext(repoPath: string): { branch: string | null; last_commit: string | null; commits_30d: number; top_contributors_30d: string[] } {
  const branch = safeGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const lastCommit = safeGit(repoPath, ['log', '-1', '--pretty=%h %s']);
  let commits30d: number | null = null;
  try {
    const out = safeGit(repoPath, ['rev-list', '--count', '--since=30 days ago', 'HEAD']);
    commits30d = out === null ? 0 : parseInt(out, 10) || 0;
  } catch {
    commits30d = 0;
  }
  let topContrib: string[] = [];
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
  } catch {
    topContrib = [];
  }
  return {
    branch: branch && branch !== 'HEAD' ? branch : null,
    last_commit: lastCommit,
    commits_30d: commits30d ?? 0,
    top_contributors_30d: topContrib,
  };
}

export async function sessionResumeBrief(repoPath: string) {
  const resolved = path.resolve(repoPath);
  const name = path.basename(resolved);
  const hash = repoHash(resolved);
  const db = initDb(resolved);
  try {
    const stats = getIndexStats(db);
    const gate = getRepoVisionGate(db);
    const scanStopReason = getIndexMeta(db, 'scan_stop_reason') || 'unknown';
    const partialIndex = getIndexMeta(db, 'partial_index') === '1';
    const discovered = estimateRawSourceStats(resolved, { maxScanMs: 5000 });
    const memory = summarizeMemory(resolved);
    const benchmarkJson = readJsonIfExists(path.join(resolved, '.omnicode', 'benchmark.json'));
    const handoffPath =
      (memory.latestHandoff?.data?.path as string | undefined) ||
      newestExisting([
        path.join(resolved, '.omnicode', 'NO_SPAGHETT_REPAIR_HANDOFF.md'),
        path.join(resolved, '.omnicode', 'NO_SPAGHETT_REPAIR_HANDOFF_TEST.md'),
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
    `).all() as Array<{ parser_mode: string; language_name: string; files: number; avg_quality: number }>;

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
    `).all() as Array<{ path: string; reason: string }>;

    const computedRiskyFiles = db.prepare(`
      SELECT f.path, f.parser_mode, f.parse_quality, COUNT(b.id) AS blindspots
      FROM files f
      LEFT JOIN blindspots b ON b.file_id = f.id
      WHERE f.parser_mode IN ('fallback', 'none', 'skipped') OR f.parse_quality < 0.6 OR b.id IS NOT NULL
      GROUP BY f.id
      ORDER BY blindspots DESC, f.parse_quality ASC
      LIMIT 10
    `).all() as Array<{ path: string; parser_mode: string; parse_quality: number; blindspots: number }>;

    const computedSafeFiles = db.prepare(`
      SELECT path, parser_mode, parse_quality
      FROM files
      WHERE parser_mode = 'tree-sitter' AND parse_quality >= 0.9
      ORDER BY indexed_at DESC
      LIMIT 10
    `).all() as Array<{ path: string; parser_mode: string; parse_quality: number }>;

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
    `).all() as Array<{ language: string; files: number; avg_quality: number | null }>;

    const topSymbols = db.prepare(`
      SELECT s.name, s.kind, f.path AS file_path, COALESCE(s.importance_score, 0) AS importance
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.kind IN ('function', 'method', 'class')
      ORDER BY importance DESC, s.name ASC
      LIMIT 10
    `).all() as Array<{ name: string; kind: string; file_path: string; importance: number }>;

    const stack = detectStack(resolved);
    if (languageBreakdown[0]) stack.primary_language = languageBreakdown[0].language;
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
    } else if (partialIndex || gate.risk === 'HIGH') {
      exactNextAction = 'Inspect blindspots and avoid destructive actions.';
      recommendedTool = 'blindspot_report';
    } else if (!benchmarkJson && !memory.latestBenchmark) {
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
      memory_file: memoryFilePath(resolved),
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
  } finally {
    db.close();
  }
}
