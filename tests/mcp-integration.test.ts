import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { indexProject } from '../omnicode-mcp/src/tools/index_project';
import { searchSymbols } from '../omnicode-mcp/src/tools/search_symbols';
import { getSymbol } from '../omnicode-mcp/src/tools/get_symbol';
import { fileOutline } from '../omnicode-mcp/src/tools/file_outline';
import { blastRadius } from '../omnicode-mcp/src/tools/blast_radius';
import { deadCodeScan } from '../omnicode-mcp/src/tools/dead_code_scan';
import { spaghettiReport } from '../omnicode-mcp/src/tools/spaghetti_report';
import { getDbPath, initDb } from '../omnicode-mcp/src/store/db';

// ── Shared temp repo ────────────────────────────────────────────────────

const REPO = path.join(os.tmpdir(), `omnicode-test-${crypto.randomBytes(6).toString('hex')}`);

function setup() {
  fs.mkdirSync(REPO, { recursive: true });

  fs.writeFileSync(path.join(REPO, 'utils.ts'), `
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}
`.trim());

  fs.writeFileSync(path.join(REPO, 'main.ts'), `
import { add, multiply } from './utils';

export function runCalc(x: number, y: number): number {
  const sum = add(x, y);
  return multiply(sum, 2);
}
`.trim());

  fs.writeFileSync(path.join(REPO, 'duplicate-a.ts'), `
export function callerA(): number {
  return helper();
}

function helper(): number {
  return 1;
}
`.trim());

  fs.writeFileSync(path.join(REPO, 'duplicate-b.ts'), `
export function callerB(): number {
  return helper();
}

function helper(): number {
  return 2;
}
`.trim());

  fs.mkdirSync(path.join(REPO, 'app'), { recursive: true });
  fs.mkdirSync(path.join(REPO, 'components'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'app', 'page.tsx'), `
import { Widget } from '@/components/Widget';

export default function Page() {
  return <Widget />;
}
`.trim());

  fs.writeFileSync(path.join(REPO, 'components', 'Widget.tsx'), `
export function Widget() {
  return <div>Widget</div>;
}
`.trim());
}

setup();

afterAll(() => {
  fs.rmSync(REPO, { recursive: true, force: true });
  // Close the SQLite connection before deleting — WAL mode keeps a file lock on Windows.
  try { initDb(REPO).close(); } catch {}
  try { const dbPath = getDbPath(REPO); if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch {}
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('index_project', () => {
  it('indexes the repo and finds symbols', async () => {
    const result = await indexProject(REPO);
    expect(result.scannedFiles).toBeGreaterThanOrEqual(2);
    expect(result.symbolsExtracted).toBeGreaterThanOrEqual(3);
    expect(result.newlyIndexed).toBeGreaterThanOrEqual(2);
  });

  it('is idempotent — re-index finds no new files when nothing changed', async () => {
    const result = await indexProject(REPO);
    expect(result.newlyIndexed).toBe(0);
  });
});

describe('search_symbols', () => {
  it('finds a known symbol by exact name', async () => {
    const result = await searchSymbols(REPO, 'add');
    expect(result!.result).toContain('add');
  });

  it('finds symbols via fuzzy match', async () => {
    const result = await searchSymbols(REPO, 'multipl');
    expect(result!.result).toContain('multiply');
  });

  it('returns empty message when nothing matches', async () => {
    const result = await searchSymbols(REPO, 'zzz_does_not_exist_xyz');
    expect(result!.result).toMatch(/no symbols found/i);
  });

  it('respects max_results cap', async () => {
    const result = await searchSymbols(REPO, 'a', 1);
    const symbolLines = result!.result
      .trim()
      .split('\n')
      .filter((line) => line.startsWith('['));
    expect(symbolLines.length).toBeLessThanOrEqual(1);
  });

  it('reports stale freshness when a top-hit file changed after indexing', async () => {
    const utilsPath = path.join(REPO, 'utils.ts');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(utilsPath, future, future);

    const result = await searchSymbols(REPO, 'add');
    expect(result!.result).toContain('freshness 0.60');
  });

  it('refreshes indexed_at for unchanged files during reindex', async () => {
    const utilsPath = path.join(REPO, 'utils.ts');
    const now = new Date();
    fs.utimesSync(utilsPath, now, now);

    await indexProject(REPO);
    const result = await searchSymbols(REPO, 'add');
    expect(result!.result).toContain('freshness 1.00');
  });
});

describe('call graph resolution', () => {
  it('does not cross-link same-named local callees in different files', async () => {
    const db = initDb(REPO);
    const rows = db.prepare(`
      SELECT ff.path AS from_path, tf.path AS to_path
      FROM edges e
      JOIN symbols fs ON fs.id = e.from_symbol
      JOIN files ff ON ff.id = fs.file_id
      JOIN symbols ts ON ts.id = e.to_symbol
      JOIN files tf ON tf.id = ts.file_id
      WHERE e.type = 'call'
        AND fs.name = 'callerA'
        AND ts.name = 'helper'
    `).all() as Array<{ from_path: string; to_path: string }>;

    expect(rows.length).toBe(1);
    expect(path.basename(rows[0].from_path)).toBe('duplicate-a.ts');
    expect(path.basename(rows[0].to_path)).toBe('duplicate-a.ts');
  });
});

describe('get_symbol', () => {
  it('returns the source snippet for a known symbol', async () => {
    const result = await getSymbol(REPO, 'add');
    expect(result!.result).toContain('add');
    expect(result!.result).not.toMatch(/not found/i);
  });

  it('reports not found for a missing symbol', async () => {
    const result = await getSymbol(REPO, 'doesNotExist');
    expect(result!.result).toMatch(/not found/i);
  });
});

describe('file_outline', () => {
  it('lists symbols in a specific file', async () => {
    const result = await fileOutline(REPO, path.join(REPO, 'utils.ts'));
    expect(result!.result).toContain('add');
    expect(result!.result).toContain('multiply');
  });
});

describe('blast_radius', () => {
  it('returns blast radius data for a symbol', async () => {
    const result = await blastRadius(REPO, 'add');
    expect(result!.result).toBeTruthy();
    expect(result!.result).not.toMatch(/error/i);
  });
});

describe('dead_code_scan', () => {
  it('runs without crashing and returns a result', async () => {
    const result = await deadCodeScan(REPO);
    expect(result!.result).toBeTruthy();
  });
});

describe('spaghetti_report', () => {
  it('produces a health score', async () => {
    const result = await spaghettiReport(REPO);
    expect(result!.result).toMatch(/Health \d+\/100/);
  });

  it('does not mark alias-imported React components as dead code', async () => {
    const result = await spaghettiReport(REPO);
    expect(result!.result).not.toContain(`${path.join('components', 'Widget.tsx')}`);
  });

  it('does not mark backend or public runtime files as dead code', async () => {
    fs.writeFileSync(path.join(REPO, 'backend.js'), 'function startBackend() { return true; }');
    fs.mkdirSync(path.join(REPO, 'assets', 'public'), { recursive: true });
    fs.writeFileSync(path.join(REPO, 'assets', 'public', 'cordova.js'), 'function cordovaRuntime() { return true; }');

    await indexProject(REPO);
    const result = await spaghettiReport(REPO);
    expect(result!.result).not.toContain(path.join(REPO, 'backend.js'));
    expect(result!.result).not.toContain(path.join(REPO, 'assets', 'public', 'cordova.js'));
  });
});
