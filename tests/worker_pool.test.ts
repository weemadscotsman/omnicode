import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
// Use the COMPILED pool so real worker_threads spawn against dist/engine/parse_worker.js.
const { ParsePool } = require('../omnicode-mcp/dist/engine/parse_pool');
const { parseSource } = require('../omnicode-mcp/dist/engine/parser');
const { indexProject } = require('../omnicode-mcp/dist/tools/index_project');
const { initDb, getDbPath } = require('../omnicode-mcp/dist/store/db');

describe('ParsePool — parallel parse, deterministic output', () => {
  it('parses a file and matches synchronous parseSource exactly', async () => {
    const pool = new ParsePool(2);
    const src = `export function foo(){ if (true) return 1; } export class Bar { draw(){ return 2; } }`;
    const viaPool = await pool.parse('a.ts', src);
    await pool.destroy();
    const viaSync = parseSource('a.ts', src);
    expect(viaPool.symbols.map((s: any) => s.name).sort()).toEqual(viaSync.symbols.map((s: any) => s.name).sort());
    expect(viaPool.symbols.map((s: any) => s.name)).toContain('foo');
    expect(viaPool.symbols.map((s: any) => s.name)).not.toContain('if'); // keyword guard holds in workers too
  });

  it('caps stored snippets so a giant body cannot balloon the index', () => {
    // A symbol with a huge body would otherwise store the entire text (GOTHAM hit
    // ~24 KB/symbol → ~1 GB DBs). Snippets are capped; full body is reachable via offsets.
    const huge = 'export function big(){ const s = "' + 'x'.repeat(8000) + '"; return s; }';
    const r = parseSource('big.ts', huge);
    const sym = r.symbols.find((s: any) => s.name === 'big');
    expect(sym).toBeTruthy();
    expect(sym.snippet.length).toBeLessThan(1300);     // bounded, not the full 8KB+ body
    expect(sym.byteEnd - sym.byteStart).toBeGreaterThan(8000); // offsets still span the real body
  });

  it('handles many files across workers, each result correct', async () => {
    const pool = new ParsePool(4);
    const files = Array.from({ length: 24 }, (_, i) => ({ p: `f${i}.ts`, c: `export const v${i} = () => ${i};` }));
    const results = await Promise.all(files.map((f) => pool.parse(f.p, f.c)));
    await pool.destroy();
    results.forEach((r: any, i: number) => {
      expect(r.symbols.some((s: any) => s.name === `v${i}`)).toBe(true);
    });
  });
});

describe('indexProject — partial-index honesty + worker fields', () => {
  const REPO = path.join(os.tmpdir(), `omnicode-wp-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(path.join(REPO, 'src'), { recursive: true });
  for (let i = 0; i < 30; i++) {
    fs.writeFileSync(path.join(REPO, 'src', `mod${i}.ts`), `export function f${i}(){ return ${i}; }`);
  }
  afterAll(() => {
    fs.rmSync(REPO, { recursive: true, force: true });
    const d = getDbPath(REPO); for (const x of [d, d + '-wal', d + '-shm']) { try { fs.unlinkSync(x); } catch { /* */ } }
  });

  it('NO CAPS: ignores maxFiles and indexes the whole repo (never partial)', async () => {
    const d = getDbPath(REPO); for (const x of [d, d + '-wal', d + '-shm']) { try { fs.unlinkSync(x); } catch { /* */ } }
    // maxFiles:5 is passed but inert — the scan completes over all 30 files.
    const r = await indexProject(REPO, null, { maxFiles: 5, workers: 0 });
    expect(r.partialIndex).toBe(false);
    expect(r.scanStopReason).toBe(null);
    expect(r.filesIndexed).toBe(30);
  });

  it('marks a complete index as not partial and reports workers', async () => {
    const d = getDbPath(REPO); for (const x of [d, d + '-wal', d + '-shm']) { try { fs.unlinkSync(x); } catch { /* */ } }
    const r = await indexProject(REPO, null, { workers: 2 });
    expect(r.partialIndex).toBe(false);
    expect(r.scanStopReason).toBe(null);
    expect(r.workersUsed).toBeGreaterThanOrEqual(0);
    expect(r.filesIndexed).toBe(30);
  });
});

describe('repair_plan destructive guards', () => {
  const { repairPlan } = require('../omnicode-mcp/dist/tools/repair_plan');
  const { initDb, setIndexMeta } = require('../omnicode-mcp/dist/store/db');
  const REPO = path.join(os.tmpdir(), `omnicode-rp-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(path.join(REPO, 'src'), { recursive: true });
  // a connected pair + one STAGED orphan (exports an API, wired to nothing).
  fs.writeFileSync(path.join(REPO, 'src', 'a.ts'), `import { b } from './b';\nexport function a(){ return b(); }`);
  fs.writeFileSync(path.join(REPO, 'src', 'b.ts'), `export function b(){ return 1; }`);
  fs.writeFileSync(path.join(REPO, 'src', 'staged.ts'), `export function stagedApi(x: number){ return x + 1; }`);
  afterAll(() => {
    fs.rmSync(REPO, { recursive: true, force: true });
    const d = getDbPath(REPO); for (const x of [d, d + '-wal', d + '-shm']) { try { fs.unlinkSync(x); } catch { /* */ } }
  });

  it('refuses deleting a STAGED file on graph-only evidence (intent overrides graph)', async () => {
    await indexProject(REPO, null, { workers: 0 });
    const r = await repairPlan(REPO, { intent: 'delete', destructive: true, target: 'src/staged.ts' });
    expect(r.result).toMatch(/PROTECTED FILE/);
    expect(r.result).toMatch(/REFUSE DESTRUCTIVE/);
  });

  it('still refuses destructive work on a partial index (defense in depth)', async () => {
    await indexProject(REPO, null, { workers: 0 });
    // Caps can no longer truncate a scan, so force the partial flag directly to
    // prove the legacy guard still fires if a partial index ever occurs.
    const db = initDb(REPO);
    setIndexMeta(db, 'partial_index', '1');
    setIndexMeta(db, 'scan_stop_reason', 'forced_for_test');
    db.close();
    const r = await repairPlan(REPO, { intent: 'delete', destructive: true });
    expect(r.result).toMatch(/PARTIAL INDEX/);
    expect(r.result).toMatch(/REFUSE DESTRUCTIVE/);
  });
});
