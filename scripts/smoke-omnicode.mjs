#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distTool = (name) => path.join(root, 'omnicode-mcp', 'dist', 'tools', `${name}.js`);
const distStore = path.join(root, 'omnicode-mcp', 'dist', 'store', 'db.js');
const required = [distTool('index_project'), distTool('search_symbols'), distTool('get_symbol'), distTool('spaghetti_report'), distStore];

for (const file of required) {
  if (!fs.existsSync(file)) {
    console.error(`[FAIL] Missing built MCP file: ${file}`);
    console.error('Run: npm run build --prefix omnicode-mcp');
    process.exit(1);
  }
}

const toFileUrl = (p) => pathToFileURL(p).href;
const { indexProject } = await import(toFileUrl(distTool('index_project')));
const { searchSymbols } = await import(toFileUrl(distTool('search_symbols')));
const { getSymbol } = await import(toFileUrl(distTool('get_symbol')));
const { spaghettiReport } = await import(toFileUrl(distTool('spaghetti_report')));
const { getDbPath, initDb } = await import(toFileUrl(distStore));

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function writeRepo(repo) {
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, 'math.ts'), `
export function add(a: number, b: number): number { return a + b; }
export function multiply(a: number, b: number): number { return a * b; }
`.trim());
  fs.writeFileSync(path.join(repo, 'main.ts'), `
import { add, multiply } from './math';
export function runCalc(x: number, y: number): number {
  const sum = add(x, y);
  return multiply(sum, 2);
}
`.trim());
}

const repo = path.join(os.tmpdir(), `omnicode-smoke-${crypto.randomBytes(6).toString('hex')}`);
let failures = 0;
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
};

try {
  writeRepo(repo);

  await step('index_project populates symbols', async () => {
    const result = await indexProject(repo);
    assert(result.scannedFiles >= 2, `expected >=2 files, got ${result.scannedFiles}`);
    assert(result.symbolsExtracted >= 3, `expected >=3 symbols, got ${result.symbolsExtracted}`);
  });

  await step('search_symbols uses WRR and confidence footer', async () => {
    const result = await searchSymbols(repo, 'runCalc', 3);
    assert(/runCalc/.test(result.result), 'runCalc missing from search result');
    assert(/confidence/i.test(result.result), 'confidence footer missing');
    assert(/identity\+lexical\+structural/.test(result.result), 'channel footer missing');
  });

  await step('get_symbol returns exact source capsule equivalent', async () => {
    const result = await getSymbol(repo, 'runCalc');
    assert(/runCalc/.test(result.result), 'runCalc source missing');
    assert(/MUNCH AGENT HINT/.test(result.result), 'agent hint missing');
  });

  await step('spaghetti_report runs on indexed graph', async () => {
    const result = await spaghettiReport(repo);
    assert(/Health \d+\/100/.test(result.result), 'health score missing');
  });

  await step('MCP CLI status runs against repo cwd', async () => {
    const cli = path.join(root, 'omnicode-mcp', 'dist', 'cli.js');
    const res = spawnSync(process.execPath, [cli, 'status'], { cwd: repo, encoding: 'utf8' });
    assert(res.status === 0, res.stderr || res.stdout || `exit ${res.status}`);
    assert(/OmniCode Repository Status/.test(res.stdout), 'status heading missing');
  });
} finally {
  try { initDb(repo).close(); } catch {}
  try { const dbPath = getDbPath(repo); if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch {}
  fs.rmSync(repo, { recursive: true, force: true });
}

if (failures > 0) process.exit(1);
console.log('[PASS] OmniCode smoke complete');


