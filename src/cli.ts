#!/usr/bin/env node

import { Command } from 'commander';
import { initDb } from './store/db';
import { indexProject } from './tools/index_project';
import { benchmarkRepo, renderBenchmarkMarkdown } from './tools/benchmark';
import { cloneAndIndex } from './tools/clone_and_index';
import { sessionResumeBrief } from './tools/session_resume_brief';
import { resolveAll } from './tools/resolve_all';
import { blindspotExplorer } from './tools/blindspot_explorer';
import { getFileContext } from './tools/get_file_context';
import { getSessionStats } from './telemetry';
import { outputBudgetConfig } from './engine/output_budget';
import { resolveConfiguredRepoPath } from './engine/config';
import { getDbPath } from './store/db';
import os from 'os';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import process from 'process';

const program = new Command();

program
  .name('omnicode')
  .description('OmniCode Model Context Protocol CLI')
  .version('0.1.0');

program.command('status')
  .argument('[repo]', 'Repository path', process.cwd())
  .description('Show repo completeness, index freshness, and top sleeping symbols')
  .action((repo: string) => {
    const repoPath = resolveConfiguredRepoPath(repo);
    const db = initDb(repoPath);
    const blindspotsRes = db.prepare('SELECT COUNT(*) as c FROM blindspots').get() as { c: number };
    const symbolsRes = db.prepare('SELECT COUNT(*) as c FROM symbols').get() as { c: number };
    const filesRes = db.prepare('SELECT COUNT(*) as c FROM files').get() as { c: number };
    let completeness = 100;
    if (symbolsRes.c > 0) completeness = Math.max(0, 100 - (blindspotsRes.c / symbolsRes.c) * 100);
    const freshnessRes = db.prepare('SELECT MAX(indexed_at) as latest FROM files').get() as { latest: string | null } | undefined;
    const freshness = freshnessRes?.latest ? new Date(freshnessRes.latest.replace(' ', 'T') + 'Z').toLocaleString() : 'Never indexed';
    const sleeping = db.prepare(`
      SELECT s.name, s.kind, f.path,
             (SELECT COUNT(*) FROM edges e WHERE e.to_symbol = s.id) as incoming_edges,
             COALESCE(s.importance_score, 0) AS importance_score
      FROM symbols s JOIN files f ON s.file_id = f.id
      WHERE s.name NOT IN ('default', 'main', 'index', 'App', 'Layout')
      ORDER BY ((SELECT COUNT(*) FROM edges e WHERE e.to_symbol = s.id) * 10) + COALESCE(s.importance_score, 0) ASC
      LIMIT 5
    `).all() as any[];
    console.log('=== OmniCode Repository Status ===');
    console.log(`Repo: ${repoPath}`);
    console.log(`Files indexed: ${filesRes.c}`);
    console.log(`Index freshness: ${freshness}`);
    console.log(`Repo completeness: ${completeness.toFixed(1)}%`);
    console.log(`Blindspots: ${blindspotsRes.c}`);
    console.log('\nTop 5 Sleeping Symbols:');
    if (!sleeping.length) console.log('  None found.');
    else console.table(sleeping.map(s => ({ Name: s.name, Kind: s.kind, Incoming: s.incoming_edges, Score: Number(s.importance_score).toFixed(2), File: s.path })));
    db.close();
  });

program.command('index')
  .argument('[repo]', 'Repository path', process.cwd())
  .option('--max-files <n>', 'Maximum source files to index', (v: string) => Number(v))
  .option('--max-bytes <n>', 'Maximum source bytes to index', (v: string) => Number(v))
  .option('--max-scan-ms <n>', 'Maximum scan time in ms', (v: string) => Number(v))
  .description('Index a repository with large-repo guards')
  .action(async (repo: string, opts: any) => {
    const result = await indexProject(resolveConfiguredRepoPath(repo), undefined, { maxFiles: opts.maxFiles, maxBytes: opts.maxBytes, maxScanMs: opts.maxScanMs });
    console.log(JSON.stringify(result, null, 2));
  });

program.command('resolve-all')
  .argument('[repo]', 'Repository path', process.cwd())
  .option('--no-reindex', 'Report from the existing index without re-indexing')
  .option('--no-write', 'Do not write resolution report artifacts')
  .description('Zero Unknown Files: classify and resolve every file, write resolution reports')
  .action(async (repo: string, opts: any) => {
    const res = await resolveAll(resolveConfiguredRepoPath(repo), { reindex: opts.reindex, write: opts.write });
    console.log(res.result);
  });

program.command('blindspots')
  .argument('[repo]', 'Repository path', process.cwd())
  .option('--top <n>', 'How many top unresolved references to show', (v: string) => Number(v), 20)
  .option('--explain', 'Add per-class and per-reference guidance')
  .description('Explore blindspots: classes, top unresolved references, and why each is unresolved')
  .action(async (repo: string, opts: any) => {
    const res = await blindspotExplorer(resolveConfiguredRepoPath(repo), { top: opts.top, explain: !!opts.explain });
    console.log(res.result);
  });

program.command('clean')
  .argument('[repo]', 'Repository to clear the cache for; omit to clear ALL cached indexes')
  .option('--all', 'Clear every cached index DB')
  .option('--dry-run', 'Show what would be freed without deleting')
  .description('Reclaim disk: delete regenerable OmniCode index caches (rebuilt on next index)')
  .action((repo: string | undefined, opts: any) => {
    const dir = process.env.OMNICODE_DB_DIR ? path.resolve(process.env.OMNICODE_DB_DIR) : path.join(os.homedir(), '.omnicode');
    if (!fs.existsSync(dir)) { console.log('No cache directory found.'); return; }
    const targets: string[] = [];
    if (repo && !opts.all) {
      const base = getDbPath(path.resolve(repo));
      for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(base + suffix)) targets.push(base + suffix);
    } else {
      for (const f of fs.readdirSync(dir)) if (/\.db(-wal|-shm)?$/.test(f)) targets.push(path.join(dir, f));
    }
    let bytes = 0;
    for (const t of targets) { try { bytes += fs.statSync(t).size; } catch { /* */ } }
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    if (opts.dryRun) { console.log(`Would delete ${targets.length} cache file(s), freeing ~${mb} MB.`); return; }
    let removed = 0;
    for (const t of targets) { try { fs.unlinkSync(t); removed++; } catch { /* */ } }
    console.log(`Cleared ${removed} cache file(s), freed ~${mb} MB. Indexes rebuild on next use.`);
  });

program.command('mcp-config')
  .option('--client <name>', 'claude | claude-code | cursor | codex | generic', 'generic')
  .option('--name <serverName>', 'MCP server name', 'omnicode')
  .description('Print a paste-ready MCP server config for your client (Claude/Cursor/Codex)')
  .action((opts: any) => {
    const serverPath = path.join(__dirname, 'server.js');
    const node = process.execPath;
    const name = opts.name || 'omnicode';
    const jsonBlock = JSON.stringify({ mcpServers: { [name]: { command: node, args: [serverPath] } } }, null, 2);
    switch ((opts.client || 'generic').toLowerCase()) {
      case 'claude-code':
        console.log(`# Add OmniCode to Claude Code (run this):\n`);
        console.log(`claude mcp add ${name} -- "${node}" "${serverPath}"\n`);
        break;
      case 'codex':
        console.log(`# Add to ~/.codex/config.toml:\n`);
        console.log(`[mcp_servers.${name}]\ncommand = "${node.replace(/\\/g, '\\\\')}"\nargs = ["${serverPath.replace(/\\/g, '\\\\')}"]\n`);
        break;
      case 'cursor':
        console.log(`# Paste into ~/.cursor/mcp.json (or .cursor/mcp.json in your project):\n`);
        console.log(jsonBlock + '\n');
        break;
      case 'claude':
        console.log(`# Paste into your claude_desktop_config.json (Settings → Developer → Edit Config):\n`);
        console.log(jsonBlock + '\n');
        break;
      default:
        console.log(`# Generic MCP config (Claude Desktop / Cursor use this shape):\n`);
        console.log(jsonBlock);
        console.log(`\n# Claude Code:  claude mcp add ${name} -- "${node}" "${serverPath}"`);
        console.log(`# Tip: omnicode mcp-config --client claude|claude-code|cursor|codex`);
    }
  });

program.command('doctor')
  .description('Check OmniCode install health, native deps, dist build, git, and MCP config path')
  .action(() => {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
    add('node', Number(process.versions.node.split('.')[0]) >= 18, `Node ${process.versions.node}`);
    add('dist/server.js', fs.existsSync(path.join(__dirname, 'server.js')), path.join(__dirname, 'server.js'));
    for (const mod of ['better-sqlite3', 'tree-sitter', 'tree-sitter-javascript', 'tree-sitter-typescript']) {
      try {
        require.resolve(mod);
        add(`module:${mod}`, true, 'resolved');
      } catch (err: any) {
        add(`module:${mod}`, false, err.message);
      }
    }
    try {
      const git = spawn(process.platform === 'win32' ? 'git.exe' : 'git', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      git.on('close', (code) => {
        add('git', code === 0, code === 0 ? 'available' : 'not available');
        printDoctor(checks);
      });
      git.on('error', (err) => {
        add('git', false, err.message);
        printDoctor(checks);
      });
    } catch (err: any) {
      add('git', false, err.message);
      printDoctor(checks);
    }
  });

program.command('resume')
  .argument('[repo]', 'Repository path', process.cwd())
  .description('Print a compact session_resume_brief for the repo')
  .action(async (repo: string) => {
    const result = await sessionResumeBrief(resolveConfiguredRepoPath(repo));
    console.log(result.result);
  });

program.command('context')
  .argument('<file>', 'Repo-relative or absolute file path')
  .argument('[repo]', 'Repository path', process.cwd())
  .option('--max-tokens <n>', 'Maximum returned context tokens', (v: string) => Number(v), 6000)
  .option('--dependency-limit <n>', 'Maximum direct dependencies to include', (v: string) => Number(v), 12)
  .description('Return a file plus resolved direct internal dependencies under a token budget')
  .action(async (file: string, repo: string, opts: any) => {
    const result = await getFileContext(resolveConfiguredRepoPath(repo), file, opts.maxTokens, opts.dependencyLimit);
    console.log(result.result);
  });

program.command('token-stats')
  .argument('[repo]', 'Repository path', process.cwd())
  .description('Print live token savings and output budget stats')
  .action((repo: string) => {
    const repoPath = resolveConfiguredRepoPath(repo);
    const db = initDb(repoPath);
    const files = db.prepare(`SELECT COALESCE(SUM(size), 0) AS bytes FROM files`).get() as { bytes: number };
    const symbols = db.prepare(`SELECT COALESCE(SUM(LENGTH(snippet)), 0) AS bytes FROM symbols`).get() as { bytes: number };
    const rawTokens = Math.round((files.bytes || 0) / 4);
    const symbolTokens = Math.round((symbols.bytes || 0) / 4);
    const reduction = rawTokens > 0 ? Math.max(0, 100 - (symbolTokens / rawTokens) * 100) : 0;
    console.log(JSON.stringify({
      repo: repoPath,
      estimated_raw_file_tokens: rawTokens,
      estimated_indexed_symbol_tokens: symbolTokens,
      estimated_retrieval_payload_reduction_percent: Number(reduction.toFixed(1)),
      live_session: getSessionStats(),
      output_budget: outputBudgetConfig(),
    }, null, 2));
  });

program.command('benchmark')
  .argument('[repo]', 'Repository path', process.cwd())
  .option('--max-files <n>', 'Maximum source files to scan/index', (v: string) => Number(v))
  .option('--max-bytes <n>', 'Maximum source bytes to scan/index', (v: string) => Number(v))
  .option('--max-scan-ms <n>', 'Maximum scan time in ms', (v: string) => Number(v))
  .option('--query <q>', 'Search query used for benchmark', 'app')
  .option('--no-write', 'Do not write .omnicode benchmark artifacts')
  .description('Run benchmark v2 and write BENCHMARK.md + benchmark.json')
  .action(async (repo: string, opts: any) => {
    const result = await benchmarkRepo(resolveConfiguredRepoPath(repo), { max_files: opts.maxFiles, max_bytes: opts.maxBytes, max_scan_ms: opts.maxScanMs, query: opts.query, write: opts.write });
    console.log(renderBenchmarkMarkdown(result));
  });

program.command('clone-index')
  .argument('<repo_url>', 'Public GitHub HTTPS URL')
  .option('--branch <branch>', 'Branch to clone (optional; omitted uses the repo default branch)')
  .option('--fresh', 'Delete cached clone first')
  .option('--max-bytes <n>', 'Max cloned repo bytes', (v: string) => Number(v))
  .option('--timeout-ms <n>', 'Git clone timeout', (v: string) => Number(v))
  .option('--max-files <n>', 'Max files to index', (v: string) => Number(v))
  .description('Safely shallow-clone a public GitHub repo into ~/.omnicode/clones and index it')
  .action(async (repoUrl: string, opts: any) => {
    const result = await cloneAndIndex(repoUrl, { branch: opts.branch, fresh: !!opts.fresh, max_bytes: opts.maxBytes, timeout_ms: opts.timeoutMs, max_files: opts.maxFiles });
    console.log(JSON.stringify(result, null, 2));
  });

program.command('bench-many')
  .argument('<list_file>', 'Text file with one local repo path or public GitHub URL per line')
  .option('--out <dir>', 'Output directory', path.join(process.cwd(), '.omnicode-bench'))
  .option('--max-files <n>', 'Maximum files per repo', (v: string) => Number(v))
  .option('--max-scan-ms <n>', 'Maximum scan time per repo in ms', (v: string) => Number(v))
  .option('--repo-timeout-ms <n>', 'Hard timeout for each isolated benchmark child', (v: string) => Number(v), 15 * 60 * 1000)
  .description('Run benchmark v2 across many repos and produce a matrix')
  .action(async (listFile: string, opts: any) => {
    const outDir = path.resolve(opts.out);
    fs.mkdirSync(outDir, { recursive: true });
    const rows: any[] = [];
    const inputs = fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map((l: string) => l.trim()).filter((l: string) => l && !l.startsWith('#'));
    const ndjsonPath = path.join(outDir, 'benchmarks.ndjson');
    fs.writeFileSync(ndjsonPath, '', 'utf8');
    for (const input of inputs) {
      try {
        let repoPath = input;
        if (/^https:\/\/github\.com\//.test(input)) {
          const cloned = await cloneAndIndex(input, { max_files: opts.maxFiles, max_bytes: opts.maxBytes });
          repoPath = cloned.clonePath;
        }
        const result = await runIsolatedBenchmark(path.resolve(repoPath), {
          maxFiles: opts.maxFiles,
          maxScanMs: opts.maxScanMs,
          timeoutMs: opts.repoTimeoutMs,
          write: true,
        });
        rows.push(result);
        fs.appendFileSync(ndjsonPath, JSON.stringify(result) + '\n', 'utf8');
      } catch (e: any) {
        const err = { repo_path: input, error: e.message, generated_at: new Date().toISOString() };
        rows.push(err);
        fs.appendFileSync(ndjsonPath, JSON.stringify(err) + '\n', 'utf8');
      }
    }
    const matrix = renderMatrix(rows);
    fs.writeFileSync(path.join(outDir, 'BENCHMARK_MATRIX.md'), matrix, 'utf8');
    fs.writeFileSync(path.join(outDir, 'benchmark-summary.json'), JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2), 'utf8');
    console.log(matrix);
    console.log(`\nWrote ${ndjsonPath}`);
  });

program.command('bench-drive')
  .argument('[root]', 'Root folder to discover project folders from', 'E:\\god folder')
  .option('--out <dir>', 'Output directory', path.join(process.cwd(), '.omnicode-drive-bench'))
  .option('--manifest <file>', 'Use an existing manifest instead of discovering projects')
  .option('--write-manifest <file>', 'Write discovered project manifest to this file')
  .option('--max-depth <n>', 'Maximum directory depth below root during discovery', (v: string) => Number(v), 5)
  .option('--limit <n>', 'Limit number of projects to run', (v: string) => Number(v))
  .option('--resume', 'Skip repos already present in benchmarks.ndjson')
  .option('--clean-before', 'Delete repo OmniCode cache before each benchmark')
  .option('--no-clean-after', 'Keep repo OmniCode cache after each benchmark')
  .option('--write-repo-artifacts', 'Let each benchmark write .omnicode artifacts inside the repo')
  .option('--pause-ms <n>', 'Pause between repos in ms', (v: string) => Number(v), 250)
  .option('--max-files <n>', 'Maximum files per repo', (v: string) => Number(v))
  .option('--max-scan-ms <n>', 'Maximum scan time per repo in ms', (v: string) => Number(v))
  .option('--repo-timeout-ms <n>', 'Hard timeout for each isolated benchmark child', (v: string) => Number(v), 15 * 60 * 1000)
  .description('Discover and benchmark many local project folders one-by-one with cache cleanup')
  .action(async (root: string, opts: any) => {
    const rootPath = path.resolve(root);
    const outDir = path.resolve(opts.out);
    fs.mkdirSync(outDir, { recursive: true });

    let projects = opts.manifest
      ? readManifest(path.resolve(opts.manifest))
      : discoverProjectRoots(rootPath, { maxDepth: opts.maxDepth });
    projects = Array.from(new Set(projects.map((p) => path.resolve(p)))).sort((a, b) => a.localeCompare(b));
    if (opts.limit) projects = projects.slice(0, opts.limit);

    const manifestPath = opts.writeManifest
      ? path.resolve(opts.writeManifest)
      : path.join(outDir, 'discovered-projects.txt');
    fs.writeFileSync(manifestPath, projects.join('\n') + (projects.length ? '\n' : ''), 'utf8');

    const ndjsonPath = path.join(outDir, 'benchmarks.ndjson');
    if (!fs.existsSync(ndjsonPath)) fs.writeFileSync(ndjsonPath, '', 'utf8');
    const completed = opts.resume ? readCompletedRepos(ndjsonPath) : new Set<string>();

    const rows: any[] = [];
    const startedAt = new Date().toISOString();
    console.log(`Discovered ${projects.length} project folder(s).`);
    console.log(`Manifest: ${manifestPath}`);
    console.log(`Output: ${outDir}`);
    console.log(`Cache cleanup: before=${!!opts.cleanBefore}, after=${opts.cleanAfter !== false}`);

    let index = 0;
    for (const repoPath of projects) {
      index++;
      if (completed.has(path.resolve(repoPath))) {
        console.log(`[${index}/${projects.length}] SKIP already completed: ${repoPath}`);
        continue;
      }

      console.log(`[${index}/${projects.length}] BENCH ${repoPath}`);
      if (opts.cleanBefore) cleanRepoCache(repoPath);

      try {
        const result = await runIsolatedBenchmark(path.resolve(repoPath), {
          maxFiles: opts.maxFiles,
          maxScanMs: opts.maxScanMs,
          timeoutMs: opts.repoTimeoutMs,
          write: !!opts.writeRepoArtifacts,
        });
        rows.push(result);
        fs.appendFileSync(ndjsonPath, JSON.stringify(result) + '\n', 'utf8');
        console.log(`  OK ${result.cumulative?.reduction_display || 'n/a'} files=${result.resolution?.files_accounted ?? result.index?.indexed_files ?? 'n/a'} unknown=${result.resolution?.unknown_files ?? 'n/a'}`);
      } catch (e: any) {
        const err = { repo_path: repoPath, error: e.message, generated_at: new Date().toISOString() };
        rows.push(err);
        fs.appendFileSync(ndjsonPath, JSON.stringify(err) + '\n', 'utf8');
        console.log(`  ERROR ${e.message}`);
      } finally {
        if (opts.cleanAfter !== false) cleanRepoCache(repoPath);
      }

      if (opts.pauseMs > 0) await sleep(opts.pauseMs);
    }

    const allRows = readRows(ndjsonPath);
    const matrix = renderMatrix(allRows);
    fs.writeFileSync(path.join(outDir, 'BENCHMARK_MATRIX.md'), matrix, 'utf8');
    fs.writeFileSync(path.join(outDir, 'benchmark-summary.json'), JSON.stringify({
      generated_at: new Date().toISOString(),
      started_at: startedAt,
      root: rootPath,
      manifest: manifestPath,
      cache_cleanup: { before: !!opts.cleanBefore, after: opts.cleanAfter !== false },
      aggregate: aggregateRows(allRows),
      rows: allRows,
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'AGGREGATE.md'), renderAggregateMarkdown(aggregateRows(allRows), outDir), 'utf8');

    console.log('\n' + renderAggregateMarkdown(aggregateRows(allRows), outDir));
    console.log(`\nWrote ${ndjsonPath}`);
  });

program.command('sweep')
  .argument('<root>', 'Root folder to sweep, e.g. E:\\god folder')
  .option('--out <dir>', 'Output directory', path.join(process.cwd(), '.omnicode-sweep'))
  .option('--max-depth <n>', 'Maximum directory depth below root during discovery', (v: string) => Number(v), 5)
  .option('--max-projects <n>', 'Maximum projects to benchmark', (v: string) => Number(v))
  .option('--project-detection <mode>', 'strict | loose', 'loose')
  .option('--resume', 'Resume from sweep-resume.json / existing sweep-results.ndjson')
  .option('--dry-run', 'Only discover and classify folders; do not benchmark')
  .option('--cache-policy <policy>', 'delete-after-each | keep-small | keep-all', 'delete-after-each')
  .option('--keep-cache', 'Alias for --cache-policy keep-all')
  .option('--keep-small-mb <n>', 'For keep-small, keep cache only if DB total is under this MB', (v: string) => Number(v), 25)
  .option('--min-free-gb <n>', 'Stop before disk free drops below this GB', (v: string) => Number(v), 10)
  .option('--pause-ms <n>', 'Pause between repos in ms', (v: string) => Number(v), 250)
  .option('--max-files <n>', 'Maximum files per repo', (v: string) => Number(v))
  .option('--max-scan-ms <n>', 'Maximum scan time per repo in ms', (v: string) => Number(v))
  .option('--repo-timeout-ms <n>', 'Hard timeout for each isolated benchmark child', (v: string) => Number(v), 15 * 60 * 1000)
  .option('--write-repo-artifacts', 'Let each benchmark write .omnicode artifacts inside project folders')
  .description('Sweep many local project folders one-by-one with resume, disk logs, and cache cleanup')
  .action(async (root: string, opts: any) => {
    const rootPath = path.resolve(root);
    const outDir = path.resolve(opts.out);
    fs.mkdirSync(outDir, { recursive: true });

    const detectionMode = String(opts.projectDetection || 'loose').toLowerCase() as ProjectDetectionMode;
    if (!['strict', 'loose'].includes(detectionMode)) throw new Error(`Invalid --project-detection ${detectionMode}`);
    const discovery = discoverSweepTargets(rootPath, opts.maxDepth, detectionMode);
    const detectedProjects = discovery.projects.sort((a, b) => a.path.localeCompare(b.path));
    let projects = detectedProjects.map((p) => p.path);
    if (opts.maxProjects) projects = projects.slice(0, opts.maxProjects);
    const queuedItems = detectedProjects.filter((item) => projects.includes(item.path));

    const cachePolicy = opts.keepCache ? 'keep-all' : String(opts.cachePolicy || 'delete-after-each');
    if (!['delete-after-each', 'keep-small', 'keep-all'].includes(cachePolicy)) {
      throw new Error(`Invalid --cache-policy ${cachePolicy}`);
    }

    const resultsPath = path.join(outDir, 'sweep-results.ndjson');
    const diskLogPath = path.join(outDir, 'sweep-disk-log.ndjson');
    const resumePath = path.join(outDir, 'sweep-resume.json');
    if (!fs.existsSync(resultsPath)) fs.writeFileSync(resultsPath, '', 'utf8');
    if (!fs.existsSync(diskLogPath)) fs.writeFileSync(diskLogPath, '', 'utf8');

    writeSweepDiscoveryFiles(outDir, discovery, queuedItems);

    const completed = opts.resume ? readCompletedRepos(resultsPath) : new Set<string>();
    const startedAt = new Date().toISOString();
    const minFreeBytes = Number(opts.minFreeGb) * 1024 * 1024 * 1024;

    if (opts.dryRun) {
      const summary = {
        generated_at: new Date().toISOString(),
        root: rootPath,
        dry_run: true,
        project_detection: detectionMode,
        detected_projects: discovery.projects.length,
        queued_projects: projects.length,
        empty_folders: discovery.empty.length,
        not_projects: discovery.notProjects.length,
        skipped_benchmark_outputs: discovery.benchmarkOutputs.length,
        output: outDir,
      };
      fs.writeFileSync(path.join(outDir, 'sweep-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
      fs.writeFileSync(path.join(outDir, 'SWEEP_MATRIX.md'), renderSweepMatrix([], discovery, true), 'utf8');
      console.log(`Dry run complete. Detected: ${discovery.projects.length}. Queued: ${projects.length}. Empty: ${discovery.empty.length}. Not projects: ${discovery.notProjects.length}. Benchmark outputs: ${discovery.benchmarkOutputs.length}.`);
      console.log(`Output: ${outDir}`);
      return;
    }

    let processed = 0;
    for (let i = 0; i < projects.length; i++) {
      const repoPath = projects[i];
      if (completed.has(path.resolve(repoPath))) {
        console.log(`[${i + 1}/${projects.length}] SKIP completed: ${repoPath}`);
        continue;
      }

      const freeBefore = getFreeBytes(repoPath);
      if (freeBefore != null && freeBefore < minFreeBytes) {
        const stop = {
          repo_path: repoPath,
          status: 'stopped_low_disk',
          free_bytes: freeBefore,
          min_free_bytes: minFreeBytes,
          generated_at: new Date().toISOString(),
        };
        fs.appendFileSync(resultsPath, JSON.stringify(stop) + '\n', 'utf8');
        fs.writeFileSync(resumePath, JSON.stringify({ stopped_at: repoPath, reason: 'low_disk', ...stop }, null, 2), 'utf8');
        console.log(`STOP low disk before ${repoPath}. Free=${freeBefore}, min=${minFreeBytes}`);
        break;
      }

      const cacheBefore = repoCacheSize(repoPath);
      console.log(`[${i + 1}/${projects.length}] BENCH ${repoPath}`);
      const started = Date.now();
      let row: any;
      try {
        const result = await runIsolatedBenchmark(repoPath, {
          maxFiles: opts.maxFiles,
          maxScanMs: opts.maxScanMs,
          timeoutMs: opts.repoTimeoutMs,
          write: !!opts.writeRepoArtifacts,
        });
        row = {
          status: 'pass',
          project_type: detectProjectType(repoPath),
          detection_reason: detectedProjects.find((item) => item.path === repoPath)?.reason,
          cache_bytes_before_delete: cacheBefore,
          duration_ms: Date.now() - started,
          ...result,
        };
        console.log(`  OK ${row.cumulative?.reduction_display || 'n/a'} files=${row.resolution?.files_accounted ?? 'n/a'} unknown=${row.resolution?.unknown_files ?? 'n/a'}`);
      } catch (e: any) {
        row = {
          repo_path: repoPath,
          status: 'fail',
          project_type: detectProjectType(repoPath),
          detection_reason: detectedProjects.find((item) => item.path === repoPath)?.reason,
          error: e.message,
          cache_bytes_before_delete: cacheBefore,
          duration_ms: Date.now() - started,
          generated_at: new Date().toISOString(),
        };
        console.log(`  ERROR ${e.message}`);
      }

      const cacheAfterRun = repoCacheSize(repoPath);
      const cleanup = applyCachePolicy(repoPath, cachePolicy, opts.keepSmallMb);
      const cacheAfterCleanup = repoCacheSize(repoPath);
      const freeAfter = getFreeBytes(repoPath);
      row.cache_policy = cachePolicy;
      row.cache_bytes_after_run = cacheAfterRun;
      row.cache_bytes_after_cleanup = cacheAfterCleanup;
      row.cache_files_removed = cleanup.removed;
      row.cache_bytes_removed = cleanup.bytes;

      fs.appendFileSync(resultsPath, JSON.stringify(row) + '\n', 'utf8');
      fs.appendFileSync(diskLogPath, JSON.stringify({
        repo_path: repoPath,
        generated_at: new Date().toISOString(),
        free_bytes_before: freeBefore,
        free_bytes_after: freeAfter,
        cache_bytes_before_delete: cacheBefore,
        cache_bytes_after_run: cacheAfterRun,
        cache_bytes_after_cleanup: cacheAfterCleanup,
        cache_bytes_removed: cleanup.bytes,
        cache_files_removed: cleanup.removed,
      }) + '\n', 'utf8');
      processed++;
      fs.writeFileSync(resumePath, JSON.stringify({
        generated_at: new Date().toISOString(),
        root: rootPath,
        out: outDir,
        total_projects: projects.length,
        completed_or_attempted: processed,
        last_repo: repoPath,
      }, null, 2), 'utf8');
      if (opts.pauseMs > 0) await sleep(opts.pauseMs);
    }

    const rows = readRows(resultsPath);
    const aggregate = aggregateRows(rows.filter((row) => row.status !== 'stopped_low_disk'));
    fs.writeFileSync(path.join(outDir, 'SWEEP_MATRIX.md'), renderSweepMatrix(rows, discovery, false), 'utf8');
    fs.writeFileSync(path.join(outDir, 'sweep-summary.json'), JSON.stringify({
      generated_at: new Date().toISOString(),
      started_at: startedAt,
      root: rootPath,
      project_detection: detectionMode,
      cache_policy: cachePolicy,
      aggregate,
      discovery: {
        detected_projects: discovery.projects.length,
        queued_projects: projects.length,
        empty_folders: discovery.empty.length,
        not_projects: discovery.notProjects.length,
        benchmark_outputs: discovery.benchmarkOutputs.length,
      },
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(outDir, 'sweep-errors.md'), renderSweepErrors(rows), 'utf8');
    fs.writeFileSync(path.join(outDir, 'sweep-anomalies.md'), renderSweepAnomalies(rows), 'utf8');
    console.log('\n' + renderAggregateMarkdown(aggregate, outDir));
    console.log(`\nWrote ${resultsPath}`);
  });

function renderMatrix(rows: any[]): string {
  const lines = ['# OmniCode Benchmark Matrix', '', 'Reduction is MEASURED bytes (exact). Source bytes are exact; est. tokens = bytes÷4.', '', '| Repo | Source bytes | Files accounted | Unknown | Byte reduction (measured) | Anomalies |', '|---|---:|---:|---:|---:|---|'];
  for (const row of rows) {
    if (row.error) {
      lines.push(`| ${row.repo_path} | - | - | - | ERROR | ${row.error.replace(/\|/g, '/')} |`);
      continue;
    }
    const acc = row.resolution ? row.resolution.files_accounted : row.index.indexed_files;
    const unk = row.resolution ? row.resolution.unknown_files : '-';
    lines.push(`| ${path.basename(row.repo_path)} | ${row.raw.raw_bytes} | ${acc} | ${unk} | ${row.cumulative.reduction_display} | ${(row.anomalies || []).join(', ') || 'none'} |`);
  }
  return lines.join('\n');
}

function writeSweepDiscoveryFiles(outDir: string, discovery: SweepDiscovery, projects: SweepItem[]) {
  fs.writeFileSync(path.join(outDir, 'sweep-projects.txt'), projects.map((item) => `${item.path}\t${item.reason}`).join('\n') + (projects.length ? '\n' : ''), 'utf8');
  fs.writeFileSync(path.join(outDir, 'sweep-empty-folders.md'), [
    '# Empty Folders',
    '',
    ...discovery.empty.map((item) => `- ${item.path}`),
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'sweep-not-projects.md'), [
    '# Not Project Folders',
    '',
    ...discovery.notProjects.map((item) => `- ${item.path} — ${item.reason}`),
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'sweep-benchmark-outputs.md'), [
    '# Skipped Benchmark Output Folders',
    '',
    ...discovery.benchmarkOutputs.map((item) => `- ${item.path} — ${item.reason}`),
    '',
  ].join('\n'), 'utf8');
}

function renderSweepMatrix(rows: any[], discovery: SweepDiscovery, dryRun: boolean): string {
  const lines = [
    '# OmniCode Sweep Matrix',
    '',
    `Dry run: ${dryRun}`,
    `Discovered project folders: ${discovery.projects.length}`,
    `Empty folders: ${discovery.empty.length}`,
    `Not-project folders: ${discovery.notProjects.length}`,
    `Skipped benchmark output folders: ${discovery.benchmarkOutputs.length}`,
    '',
    '| Repo | Type | Status | Files accounted | Unknown | Source bytes | Byte reduction | Cache removed | Anomalies/Error |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|',
  ];
  for (const row of rows) {
    const repo = row.repo_path ? path.basename(row.repo_path) : '-';
    if (row.error || row.status === 'fail' || row.status === 'stopped_low_disk') {
      lines.push(`| ${repo} | ${row.project_type || '-'} | ${row.status || 'error'} | - | - | - | - | ${row.cache_bytes_removed || 0} | ${String(row.error || row.reason || row.status).replace(/\|/g, '/')} |`);
      continue;
    }
    lines.push(`| ${repo} | ${row.project_type || detectProjectType(row.repo_path)} | pass | ${row.resolution?.files_accounted ?? '-'} | ${row.resolution?.unknown_files ?? '-'} | ${row.raw?.raw_bytes ?? '-'} | ${row.cumulative?.reduction_display || '-'} | ${row.cache_bytes_removed || 0} | ${(row.anomalies || []).join(', ') || 'none'} |`);
  }
  return lines.join('\n');
}

function renderSweepErrors(rows: any[]): string {
  const errors = rows.filter((row) => row.error || row.status === 'fail' || row.status === 'stopped_low_disk');
  return ['# Sweep Errors', '', ...errors.map((row) => `- ${row.repo_path}: ${row.error || row.status}`), ''].join('\n');
}

function renderSweepAnomalies(rows: any[]): string {
  const lines = ['# Sweep Anomalies', ''];
  for (const row of rows) {
    if (!row.anomalies?.length) continue;
    lines.push(`## ${row.repo_path}`);
    for (const anomaly of row.anomalies) lines.push(`- ${anomaly}`);
    lines.push('');
  }
  return lines.join('\n');
}

function readManifest(filePath: string): string[] {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function readRows(ndjsonPath: string): any[] {
  if (!fs.existsSync(ndjsonPath)) return [];
  return fs.readFileSync(ndjsonPath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return { error: 'invalid ndjson row', raw: l }; }
    });
}

function readCompletedRepos(ndjsonPath: string): Set<string> {
  return new Set(readRows(ndjsonPath)
    .filter((row) => row.repo_path && !row.error)
    .map((row) => path.resolve(row.repo_path)));
}

function aggregateRows(rows: any[]) {
  const ok = rows.filter((row) => !row.error);
  const errors = rows.length - ok.length;
  let rawSourceBytes = 0;
  let baselineBytes = 0;
  let payloadBytes = 0;
  let filesAccounted = 0;
  let unknownFiles = 0;
  for (const row of ok) {
    rawSourceBytes += Number(row.raw?.raw_bytes || 0);
    baselineBytes += Number(row.cumulative?.baseline_bytes || 0);
    payloadBytes += Number(row.cumulative?.payload_bytes || 0);
    filesAccounted += Number(row.resolution?.files_accounted || 0);
    unknownFiles += Number(row.resolution?.unknown_files || 0);
  }
  const reduction = baselineBytes > 0 ? ((baselineBytes - payloadBytes) / baselineBytes) * 100 : 0;
  const factor = payloadBytes > 0 ? baselineBytes / payloadBytes : 0;
  return {
    repos: rows.length,
    successful_repos: ok.length,
    errors,
    files_accounted: filesAccounted,
    unknown_files: unknownFiles,
    raw_source_bytes: rawSourceBytes,
    raw_source_tokens_estimated: Math.round(rawSourceBytes / 4),
    operation_baseline_bytes: baselineBytes,
    operation_baseline_tokens_estimated: Math.round(baselineBytes / 4),
    payload_bytes: payloadBytes,
    payload_tokens_estimated: Math.round(payloadBytes / 4),
    measured_byte_reduction_percent: Number(reduction.toFixed(6)),
    reduction_factor: Number(factor.toFixed(2)),
  };
}

function renderAggregateMarkdown(aggregate: any, outDir: string): string {
  return [
    '# OmniCode Batch Aggregate',
    '',
    `Output: ${outDir}`,
    '',
    `- Repos discovered/run rows: ${aggregate.repos}`,
    `- Successful repos: ${aggregate.successful_repos}`,
    `- Errors: ${aggregate.errors}`,
    `- Files accounted: ${aggregate.files_accounted}`,
    `- Unknown files: ${aggregate.unknown_files}`,
    `- Raw source bytes: ${aggregate.raw_source_bytes}`,
    `- Raw source tokens estimated: ${aggregate.raw_source_tokens_estimated}`,
    `- Operation baseline bytes: ${aggregate.operation_baseline_bytes}`,
    `- Operation baseline tokens estimated: ${aggregate.operation_baseline_tokens_estimated}`,
    `- OmniCode payload bytes: ${aggregate.payload_bytes}`,
    `- OmniCode payload tokens estimated: ${aggregate.payload_tokens_estimated}`,
    `- Measured byte reduction: ${aggregate.measured_byte_reduction_percent}%`,
    `- Reduction factor: ${aggregate.reduction_factor}x`,
  ].join('\n');
}

function cleanRepoCache(repoPath: string): number {
  const base = getDbPath(path.resolve(repoPath));
  let removed = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    const target = base + suffix;
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target);
        removed++;
      } catch {
        // Best effort. A just-finished child may leave a handle briefly on Windows.
      }
    }
  }
  return removed;
}

function repoCacheFiles(repoPath: string): string[] {
  const base = getDbPath(path.resolve(repoPath));
  return ['', '-wal', '-shm'].map((suffix) => base + suffix);
}

function repoCacheSize(repoPath: string): number {
  let bytes = 0;
  for (const file of repoCacheFiles(repoPath)) {
    try {
      if (fs.existsSync(file)) bytes += fs.statSync(file).size;
    } catch {
      // Best effort only.
    }
  }
  return bytes;
}

function applyCachePolicy(repoPath: string, policy: string, keepSmallMb: number): { removed: number; bytes: number } {
  const size = repoCacheSize(repoPath);
  if (policy === 'keep-all') return { removed: 0, bytes: 0 };
  if (policy === 'keep-small' && size <= Number(keepSmallMb || 25) * 1024 * 1024) {
    return { removed: 0, bytes: 0 };
  }
  let removed = 0;
  let bytes = 0;
  for (const file of repoCacheFiles(repoPath)) {
    try {
      if (!fs.existsSync(file)) continue;
      bytes += fs.statSync(file).size;
      fs.unlinkSync(file);
      removed++;
    } catch {
      // Best effort only. Windows can hold SQLite handles briefly after child exit.
    }
  }
  return { removed, bytes };
}

function getFreeBytes(targetPath: string): number | null {
  try {
    const statfs = fs.statfsSync(path.resolve(targetPath));
    return Number(statfs.bavail) * Number(statfs.bsize);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PROJECT_MARKERS = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
  'composer.json',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'settings.gradle',
  'mix.exs',
  'deno.json',
  'bunfig.toml',
  'next.config.js',
  'next.config.mjs',
  'vite.config.js',
  'vite.config.ts',
  'tsconfig.json',
  'pnpm-workspace.yaml',
]);

const PROJECT_DIR_MARKERS = new Set([
  '.git',
  'src',
  'app',
  'server',
  'client',
  'lib',
]);

const DISCOVERY_SKIP_DIRS = new Set([
  '.git',
  '.omnicode',
  'node_modules',
  '.next',
  'dist',
  'build',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
]);

const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.rs', '.go', '.cs', '.java', '.kt', '.kts',
  '.php', '.rb', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.sol', '.lua', '.vue', '.svelte',
]);

function isBenchmarkOutputDir(dir: string, entries: fs.Dirent[]): boolean {
  const base = path.basename(dir).toLowerCase();
  if (base.startsWith('omnicode_sweep') || base.startsWith('omnicode_selected') || base.startsWith('omnicode_drive') || base.includes('omnicode_bench')) return true;
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  return files.has('sweep-results.ndjson') || files.has('benchmarks.ndjson') || files.has('BENCHMARK_MATRIX.md') || files.has('SWEEP_MATRIX.md');
}

function countSourceFilesShallow(dir: string, maxDepth: number, stopAt: number): number {
  let count = 0;
  const queue: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }];
  while (queue.length && count < stopAt) {
    const current = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (count >= stopAt) break;
      if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) count++;
      if (entry.isDirectory() && current.depth < maxDepth && !DISCOVERY_SKIP_DIRS.has(entry.name) && !entry.name.startsWith('$')) {
        queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
      }
    }
  }
  return count;
}

interface SweepItem {
  path: string;
  reason: string;
}

interface SweepDiscovery {
  projects: SweepItem[];
  empty: SweepItem[];
  notProjects: SweepItem[];
  benchmarkOutputs: SweepItem[];
}

type ProjectDetectionMode = 'strict' | 'loose';

function discoverSweepTargets(rootPath: string, maxDepth: number, mode: ProjectDetectionMode): SweepDiscovery {
  const root = path.resolve(rootPath);
  const projects: SweepItem[] = [];
  const empty: SweepItem[] = [];
  const notProjects: SweepItem[] = [];
  const benchmarkOutputs: SweepItem[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const projectSet = new Set<string>();

  while (queue.length) {
    const current = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (err: any) {
      notProjects.push({ path: current.dir, reason: `unreadable:${err.message}` });
      continue;
    }

    if (current.depth > 0 && isBenchmarkOutputDir(current.dir, entries)) {
      benchmarkOutputs.push({ path: current.dir, reason: 'benchmark_output' });
      continue;
    }

    const visible = entries.filter((entry) => !entry.name.startsWith('$'));
    if (!visible.length && current.depth > 0) {
      empty.push({ path: current.dir, reason: 'empty' });
      continue;
    }

    const detection = classifyProjectDir(current.dir, entries, mode);
    if (current.depth > 0 && detection.isProject && !projectSet.has(current.dir)) {
      projects.push({ path: current.dir, reason: detection.reason });
      projectSet.add(current.dir);
      // Do not descend into nested dependency/build folders, but still allow nested app packages
      // under monorepo containers unless this dir has strong source files itself.
    } else if (current.depth > 0 && !detection.isProject) {
      notProjects.push({ path: current.dir, reason: detection.reason });
    }

    if (current.depth >= maxDepth) continue;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (DISCOVERY_SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('$')) continue;
      queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }

  return { projects, empty, notProjects, benchmarkOutputs };
}

function classifyProjectDir(dir: string, entries: fs.Dirent[], mode: ProjectDetectionMode): { isProject: boolean; reason: string } {
  const fileNames = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const dirNames = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  const childDirCount = entries.filter((e) => e.isDirectory() && !DISCOVERY_SKIP_DIRS.has(e.name)).length;
  const manifest = [...fileNames].find((name) => PROJECT_MARKERS.has(name) || name.endsWith('.csproj') || name.endsWith('.sln'));
  if (manifest) return { isProject: true, reason: `manifest:${manifest}` };
  const git = dirNames.has('.git');
  if (git) return { isProject: true, reason: 'git_repo' };
  const markerDir = [...dirNames].find((name) => PROJECT_DIR_MARKERS.has(name));
  const sourceCountHere = entries.filter((e) => e.isFile() && SOURCE_EXTENSIONS.has(path.extname(e.name).toLowerCase())).length;
  if (childDirCount > 10 && sourceCountHere < 10) return { isProject: false, reason: `container_many_dirs:${childDirCount}` };
  if (mode === 'loose') {
    const webEntry = ['index.html', 'app.html', 'main.js'].find((name) => fileNames.has(name));
    if (webEntry) return { isProject: true, reason: `web_entry:${webEntry}` };
    if (fileNames.has('AndroidManifest.xml')) return { isProject: true, reason: 'android_manifest' };
    if (dirNames.has('res') || dirNames.has('smali')) return { isProject: true, reason: dirNames.has('smali') ? 'android_smali' : 'android_res' };
    if (markerDir) return { isProject: true, reason: `source_dir:${markerDir}` };
    const treeSourceCount = countSourceFilesShallow(dir, 2, 3);
    if (treeSourceCount >= 3) return { isProject: true, reason: `loose_tree_source_files:${treeSourceCount}` };
  }
  if (markerDir && sourceCountHere >= 1) return { isProject: true, reason: `source_dir:${markerDir}` };
  if (sourceCountHere >= 3) return { isProject: true, reason: `source_files:${sourceCountHere}` };
  if (entries.length === 0) return { isProject: false, reason: 'empty' };
  return { isProject: false, reason: 'no_project_markers' };
}

function detectProjectType(repoPath: string): string {
  let names = new Set<string>();
  try {
    names = new Set(fs.readdirSync(repoPath));
  } catch {
    return 'unknown';
  }
  const types: string[] = [];
  if (names.has('package.json') || names.has('vite.config.ts') || names.has('vite.config.js') || names.has('next.config.js') || names.has('next.config.mjs')) types.push('node');
  if (names.has('pyproject.toml') || names.has('requirements.txt') || names.has('setup.py')) types.push('python');
  if (names.has('Cargo.toml')) types.push('rust');
  if (names.has('go.mod')) types.push('go');
  if ([...names].some((n) => n.endsWith('.csproj') || n.endsWith('.sln'))) types.push('dotnet');
  if (names.has('composer.json')) types.push('php');
  if (names.has('pom.xml') || names.has('build.gradle') || names.has('settings.gradle')) types.push('java');
  if (names.has('.git')) types.push('git');
  return types.length ? types.join('+') : 'source';
}

function discoverProjectRoots(rootPath: string, opts: { maxDepth: number }): string[] {
  const projects: string[] = [];
  const root = path.resolve(rootPath);
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const current = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const fileNames = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
    const hasMarker = [...fileNames].some((name) => PROJECT_MARKERS.has(name) || name.endsWith('.csproj') || name.endsWith('.sln'));
    const sourceCount = entries.filter((e) => e.isFile() && SOURCE_EXTENSIONS.has(path.extname(e.name).toLowerCase())).length;
    if (hasMarker || sourceCount >= 3) projects.push(current.dir);

    if (current.depth >= opts.maxDepth) continue;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (DISCOVERY_SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('$')) continue;
      queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }
  return projects;
}

function appendBounded(current: string, chunk: Buffer, maxBytes: number): string {
  const next = current + chunk.toString('utf8');
  return next.length > maxBytes ? next.slice(next.length - maxBytes) : next;
}

function runIsolatedBenchmark(repoPath: string, opts: { maxFiles?: number; maxScanMs?: number; timeoutMs?: number; write?: boolean }): Promise<any> {
  return new Promise((resolve, reject) => {
    const childArgs = [
      process.env.OMNICODE_BENCH_CHILD_PATH || path.join(__dirname, 'bench_child.js'),
      '--repo', repoPath,
    ];
    if (opts.maxFiles) childArgs.push('--max-files', String(opts.maxFiles));
    if (opts.maxScanMs) childArgs.push('--max-scan-ms', String(opts.maxScanMs));
    if (opts.write) childArgs.push('--write');

    const child = spawn(process.execPath, childArgs, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = Math.max(1000, Number(opts.timeoutMs || 15 * 60 * 1000));
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error(`benchmark child timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk, 64 * 1024 * 1024); });
    child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk, 1024 * 1024); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || `benchmark child exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err: any) {
        reject(new Error(`benchmark child returned invalid JSON: ${err.message}`));
      }
    });
  });
}

function printDoctor(checks: Array<{ name: string; ok: boolean; detail: string }>) {
  const ok = checks.every((c) => c.ok);
  console.log('=== OmniCode Doctor ===');
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);
  }
  console.log('');
  console.log(`MCP server: ${path.join(__dirname, 'server.js')}`);
  console.log(`Suggested config: omnicode mcp-config --client codex|claude|cursor|claude-code`);
  if (!ok) process.exitCode = 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// omnicode init — detect AI clients, install MCP config + prompt policy
// ═══════════════════════════════════════════════════════════════════════════

type Client = 'claude-code' | 'claude-desktop' | 'cursor' | 'codex' | 'windsurf' | 'cline' | 'roo';

interface ClientDetector {
  id: Client;
  name: string;
  detect: () => boolean;
  configPath: () => string;
  policyPath: () => string;
  writeConfig: (serverPath: string, dryRun: boolean) => void;
  writePolicy: (dryRun: boolean) => void;
}

const POLICY_TEXT = `# OmniCode

This project uses **OmniCode** as the default code-intelligence MCP. Before reading raw files or running grep, prefer OmniCode tools:

- \`search_symbols\` for finding symbols
- \`get_symbol\` / \`get_file_slice\` for reading code
- \`spaghetti_report\` for architecture questions
- \`blast_radius\` before any rename or delete
- \`dead_code_scan\` for cleanup
- \`audit_agent_config\` to catch token waste in agent config

Treat **byte-exact** numbers as the only honest measurement. \`chars/4\` is a guess.

Never read raw source files when an OmniCode tool can answer the question in fewer bytes.
`;

function home(): string { return os.homedir(); }

const CLIENTS: ClientDetector[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    detect: () => fs.existsSync(path.join(home(), '.claude.json')) || fs.existsSync(path.join(home(), '.claude')),
    configPath: () => path.join(home(), '.claude.json'),
    policyPath: () => path.join(process.cwd(), 'CLAUDE.md'),
    writeConfig: (serverPath, dryRun) => writeClaudeConfig(serverPath, dryRun),
    writePolicy: (dryRun) => writePolicyFile(path.join(process.cwd(), 'CLAUDE.md'), POLICY_TEXT, dryRun),
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    detect: () => {
      const appData = process.env.APPDATA || path.join(home(), 'AppData', 'Roaming');
      return fs.existsSync(path.join(appData, 'Claude'));
    },
    configPath: () => {
      const appData = process.env.APPDATA || path.join(home(), 'AppData', 'Roaming');
      return path.join(appData, 'Claude', 'claude_desktop_config.json');
    },
    policyPath: () => path.join(process.cwd(), 'CLAUDE.md'),
    writeConfig: (serverPath, dryRun) => writeClaudeConfig(serverPath, dryRun, true),
    writePolicy: (dryRun) => writePolicyFile(path.join(process.cwd(), 'CLAUDE.md'), POLICY_TEXT, dryRun),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    detect: () => fs.existsSync(path.join(home(), '.cursor')) || fs.existsSync(path.join(home(), '.config', 'Cursor')),
    configPath: () => path.join(home(), '.cursor', 'mcp.json'),
    policyPath: () => path.join(process.cwd(), '.cursorrules'),
    writeConfig: (serverPath, dryRun) => writeClaudeConfig(serverPath, dryRun),
    writePolicy: (dryRun) => writePolicyFile(path.join(process.cwd(), '.cursorrules'), POLICY_TEXT, dryRun),
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    detect: () => fs.existsSync(path.join(home(), '.codex')),
    configPath: () => path.join(home(), '.codex', 'config.toml'),
    policyPath: () => path.join(process.cwd(), 'AGENTS.md'),
    writeConfig: (serverPath, dryRun) => writeCodexConfig(serverPath, dryRun),
    writePolicy: (dryRun) => writePolicyFile(path.join(process.cwd(), 'AGENTS.md'), POLICY_TEXT, dryRun),
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    detect: () => fs.existsSync(path.join(home(), '.windsurf')),
    configPath: () => path.join(home(), '.codeium', 'windsurf', 'mcp_config.json'),
    policyPath: () => path.join(process.cwd(), '.windsurfrules'),
    writeConfig: (serverPath, dryRun) => writeClaudeConfig(serverPath, dryRun),
    writePolicy: (dryRun) => writePolicyFile(path.join(process.cwd(), '.windsurfrules'), POLICY_TEXT, dryRun),
  },
];

function readJsonConfig(p: string): any {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function writeClaudeConfig(serverPath: string, dryRun: boolean, isDesktop = false) {
  const configPath = isDesktop
    ? path.join(process.env.APPDATA || path.join(home(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
    : path.join(home(), '.claude.json');
  const cfg = readJsonConfig(configPath);
  if (!cfg.mcpServers) cfg.mcpServers = {};
  cfg.mcpServers.omnicode = {
    command: 'cmd',
    args: ['/c', serverPath],
    enabled: true,
  };
  if (dryRun) {
    console.log(`  [dry-run] would write ${configPath}`);
    console.log(`    mcpServers.omnicode = ${JSON.stringify(cfg.mcpServers.omnicode)}`);
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
    console.log(`  ✓ wrote ${configPath}`);
  }
}

function writeCodexConfig(serverPath: string, dryRun: boolean) {
  const configPath = path.join(home(), '.codex', 'config.toml');
  let existing = '';
  try { existing = fs.readFileSync(configPath, 'utf8'); } catch {}
  const block = `\n[mcp_servers.omnicode]\ncommand = "cmd"\nargs = ["/c", ${JSON.stringify(serverPath)}]\nenabled = true\n`;
  if (existing.includes('[mcp_servers.omnicode]')) {
    console.log(`  ~ ${configPath} already has omnicode section, skipping`);
    return;
  }
  if (dryRun) {
    console.log(`  [dry-run] would append to ${configPath}:`);
    console.log(block);
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.appendFileSync(configPath, block, 'utf8');
    console.log(`  ✓ appended to ${configPath}`);
  }
}

function writePolicyFile(p: string, content: string, dryRun: boolean) {
  if (fs.existsSync(p)) {
    if (fs.readFileSync(p, 'utf8').includes('# OmniCode')) {
      console.log(`  ~ ${p} already has OmniCode policy, skipping`);
      return;
    }
    content = '\n' + content;
  }
  if (dryRun) {
    console.log(`  [dry-run] would write ${p}`);
  } else {
    fs.writeFileSync(p, content, 'utf8');
    console.log(`  ✓ wrote ${p}`);
  }
}

program.command('init')
  .argument('[client]', 'AI client to configure (claude-code, claude-desktop, cursor, codex, windsurf, all)', 'all')
  .option('--dry-run', 'Show what would be done without writing files')
  .option('--no-policy', 'Skip prompt policy file installation')
  .option('--server-path <path>', 'Path to omnicode-mcp run script', path.join(__dirname, '..', 'run_omnicode.cmd'))
  .description('Detect installed AI clients, install OmniCode MCP config + prompt policy (idempotent)')
  .action((client: string, opts: any) => {
    const detected = CLIENTS.filter(c => c.detect());
    const targets = client === 'all' ? detected : CLIENTS.filter(c => c.id === client);
    if (!targets.length) {
      console.log(`No matching clients detected. Detected: ${detected.map(c => c.id).join(', ') || '(none)'}`);
      console.log(`Specify --client manually: ${CLIENTS.map(c => c.id).join(', ')}`);
      return;
    }
    console.log(`\n  🦞 OmniCode init\n`);
    console.log(`  Detected clients: ${detected.map(c => c.id).join(', ') || '(none)'}`);
    console.log(`  Targeting: ${targets.map(c => c.id).join(', ')}`);
    console.log(`  Mode: ${opts.dryRun ? 'DRY RUN' : 'WRITE'}`);
    console.log(`  Server path: ${opts.serverPath}\n`);
    for (const c of targets) {
      console.log(`  ${c.name}:`);
      c.writeConfig(opts.serverPath, opts.dryRun);
      if (opts.policy !== false) c.writePolicy(opts.dryRun);
    }
    console.log(`\n  Done. Restart your AI client to load the new MCP server.\n`);
  });

// ───────────────────────────────────────────────────────────────────────────
// SkillVault — index, search, and load skill folders without dumping them
// into agent context. Build once, retrieve exact relevant skills on demand.
// ───────────────────────────────────────────────────────────────────────────

const skillIndexModule = require('./skills/skill_index');

program.command('skill-index')
  .argument('<skillsDir>', 'Path to the root directory containing skill folders')
  .option('--out <path>', 'Where to write the index JSON', '.omnicode/skill-index.json')
  .description('Scan a skills directory, parse SKILL.md frontmatter, write a searchable index')
  .action((skillsDir: string, opts: any) => {
    const out = path.resolve(opts.out);
    const t0 = Date.now();
    const idx = skillIndexModule.buildSkillIndex(skillsDir);
    const written = skillIndexModule.writeSkillIndexFile(idx, out);
    const elapsed = Date.now() - t0;
    console.log(`\n  🗂  SkillVault index built`);
    console.log(`  Source: ${path.resolve(skillsDir)}`);
    console.log(`  Skills: ${idx.total_skills}`);
    console.log(`  Total SKILL.md bytes: ${idx.bytes_total.toLocaleString()}`);
    console.log(`  Inverted-index tokens: ${Object.keys(idx.index).length.toLocaleString()}`);
    console.log(`  Index file: ${written}`);
    console.log(`  Elapsed: ${elapsed} ms\n`);
  });

program.command('skill-search')
  .argument('<query>', 'Free-text query for skill selection')
  .option('--index <path>', 'Path to the skill index JSON', '.omnicode/skill-index.json')
  .option('--limit <n>', 'Max number of skills to return', '5')
  .description('Search the skill index and print top-N skill cards (metadata only, no body)')
  .action((query: string, opts: any) => {
    const idx = skillIndexModule.readSkillIndexFile(path.resolve(opts.index));
    const hits = skillIndexModule.searchSkillIndex(idx, query, parseInt(opts.limit, 10));
    if (!hits.length) {
      console.log(`\n  No skills matched "${query}".\n`);
      return;
    }
    console.log(`\n  Top ${hits.length} skills for "${query}":\n`);
    for (const h of hits) {
      console.log(`  • ${h.name}  [${h.origin}]  score=${h.score.toFixed(2)}  matched=[${h.matched_tokens.join(', ')}]`);
      console.log(`    ${h.description}`);
      console.log(`    folder: ${h.rel_path}\n`);
    }
  });

program.command('skill-load')
  .argument('<skillName>', 'Exact skill name (from index)')
  .option('--index <path>', 'Path to the skill index JSON', '.omnicode/skill-index.json')
  .description('Load the full SKILL.md body of one skill (on demand only)')
  .action((skillName: string, opts: any) => {
    const idx = skillIndexModule.readSkillIndexFile(path.resolve(opts.index));
    const { meta, body } = skillIndexModule.loadSkillBody(idx, skillName);
    console.log(`\n  ╭─ ${meta.name}  [${meta.origin}]  (${meta.token_count_estimated} tok est.)`);
    console.log(`  │  ${meta.description}`);
    console.log(`  │  folder: ${meta.rel_path}`);
    console.log(`  │  files: ${meta.file_count} (refs: ${meta.has_references ? 'yes' : 'no'})`);
    console.log(`  │`);
    for (const line of body.split(/\r?\n/)) {
      console.log(`  │  ${line}`);
    }
    console.log(`  ╰─\n`);
  });

program.command('skill-pack')
  .argument('<task>', 'Free-text task description')
  .option('--index <path>', 'Path to the skill index JSON', '.omnicode/skill-index.json')
  .option('--limit <n>', 'Max skills in the pack (default 5)', '5')
  .option('--pool <n>', 'Candidate pool size before greedy selection (default 25)', '25')
  .description('Pick a minimal, diverse pack of skills that cover a task. Greedy with overlap penalty.')
  .action((task: string, opts: any) => {
    const idx = skillIndexModule.readSkillIndexFile(path.resolve(opts.index));
    const pack = skillIndexModule.buildSkillPack(
      idx, task, parseInt(opts.limit, 10), parseInt(opts.pool, 10)
    );
    console.log(`\n  📦  Skill pack for "${task}"\n`);
    console.log(`     pack size:    ${pack.pack_size}`);
    console.log(`     candidates:   ${pack.total_candidates_considered} considered`);
    console.log(`     est tokens:   ${pack.estimated_total_tokens.toLocaleString()} (sum of SKILL.md bytes÷4)\n`);
    for (const h of pack.pack) {
      console.log(`  • ${h.name}  [${h.origin}]  score=${h.score}`);
      console.log(`    ${h.description}`);
      if (h.coverage_tokens.length) {
        console.log(`    coverage: [${h.coverage_tokens.join(', ')}]`);
      }
      console.log(`    folder: ${h.rel_path}\n`);
    }
    if (pack.pack_size === 0) {
      console.log(`  (No matching skills for this task.)\n`);
    }
  });

program.parse(process.argv);
