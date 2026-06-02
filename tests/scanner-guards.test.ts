import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scanRepositoryWithStats } from '../omnicode-mcp/src/engine/scanner';

const REPO = path.join(os.tmpdir(), `omnicode-scan-${Math.random().toString(36).slice(2)}`);

function write(rel: string, bytes: number) {
  const full = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'a'.repeat(bytes));
}

fs.mkdirSync(REPO, { recursive: true });
write('src/small.ts', 1000);
write('src/medium.ts', 50 * 1024);
// A large MINIFIED blob: one giant line, no newlines → should be skipped.
{
  const full = path.join(REPO, 'src/bundle.min.js');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'a'.repeat(800 * 1024)); // single line, 800KB
}
// A large AUTHORED file: over the cap but normal line structure → must be KEPT.
{
  const full = path.join(REPO, 'src/big-authored.ts');
  const line = 'export const x' + 'y'.repeat(40) + ' = 1;\n'; // ~50 chars/line
  fs.writeFileSync(full, line.repeat(14000)); // ~700KB, ~14k lines
}

afterAll(() => fs.rmSync(REPO, { recursive: true, force: true }));

describe('scanner per-file cap — content-aware, never drops authored source', () => {
  it('skips minified blobs but KEEPS large authored source', () => {
    const { files, skipped } = scanRepositoryWithStats(REPO);
    const names = files.map((f) => path.basename(f.path));
    expect(names).toContain('small.ts');
    expect(names).toContain('medium.ts');
    expect(names).toContain('big-authored.ts');     // large but authored → indexed
    expect(names).not.toContain('bundle.min.js');    // minified → skipped
    expect(skipped.some((s) => path.basename(s.path) === 'bundle.min.js' && s.reason === 'minified')).toBe(true);
  });

  it('records every skip with a typed reason (visible, not hidden)', () => {
    const { skipped } = scanRepositoryWithStats(REPO);
    for (const s of skipped) {
      expect(['minified', 'generated', 'too_large', 'unsupported_ext']).toContain(s.reason);
      expect(s.size).toBeGreaterThan(0);
    }
  });

  it('NO CAPS: maxFiles is not enforced as a stop — the whole tree is scanned', () => {
    // Caps that STOP a scan are removed by design: a truncated scan leaves files
    // invisible and forces raw reads. maxFiles is accepted for back-compat but inert.
    const { files, stats } = scanRepositoryWithStats(REPO, { maxFiles: 1 });
    expect(files.length).toBeGreaterThan(1);     // did NOT stop at 1
    expect(stats.maxFilesHit).toBe(false);
    expect(stats.stopReason).toBe(null);
  });

  it('descends into real project dot-dirs (.github) but excludes node_modules — visibly', () => {
    const root = path.join(os.tmpdir(), `omnicode-dirs-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.ts'), 'export const ci = 1;');
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.ts'), 'export const dep = 1;');
    fs.writeFileSync(path.join(root, 'app.ts'), 'export const app = 1;');
    try {
      const { files, stats } = scanRepositoryWithStats(root);
      const names = files.map((f) => path.basename(f.path));
      expect(names).toContain('ci.ts');                 // .github recovered
      expect(names).not.toContain('index.ts');          // node_modules excluded
      // exclusions are RECORDED, not silent:
      const excluded = stats.excludedDirs.map((e) => path.basename(e.dir));
      expect(excluded).toContain('node_modules');
      expect(excluded).toContain('.git');
      expect(excluded).not.toContain('.github');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
