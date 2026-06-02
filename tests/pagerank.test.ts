import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { computePageRank, inferRepoRoot, loadTypeScriptResolver, resolveSpecifier } from '../omnicode-mcp/src/engine/pagerank';

describe('computePageRank', () => {
  it('ranks a hub (imported by everyone) highest', () => {
    const files = ['a.ts', 'b.ts', 'c.ts', 'hub.ts'];
    const edges: Array<[string, string]> = [
      ['a.ts', 'hub.ts'],
      ['b.ts', 'hub.ts'],
      ['c.ts', 'hub.ts'],
    ];
    const { scores } = computePageRank(files, edges);
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    expect(ranked[0][0]).toBe('hub.ts');
  });

  it('normalizes scores to sum ≈ 1.0', () => {
    const files = ['a.ts', 'b.ts', 'c.ts'];
    const edges: Array<[string, string]> = [['a.ts', 'b.ts'], ['b.ts', 'c.ts'], ['c.ts', 'a.ts']];
    const { scores } = computePageRank(files, edges);
    const total = [...scores.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeGreaterThan(0.98);
    expect(total).toBeLessThan(1.02);
  });

  it('a symmetric cycle gives equal ranks', () => {
    const files = ['a.ts', 'b.ts', 'c.ts'];
    const edges: Array<[string, string]> = [['a.ts', 'b.ts'], ['b.ts', 'c.ts'], ['c.ts', 'a.ts']];
    const { scores } = computePageRank(files, edges);
    const vals = [...scores.values()];
    expect(Math.max(...vals) - Math.min(...vals)).toBeLessThan(1e-3);
  });

  it('converges quickly on a small graph', () => {
    const { iterations } = computePageRank(['a.ts', 'b.ts'], [['a.ts', 'b.ts']]);
    expect(iterations).toBeLessThan(100);
  });

  it('handles an empty graph', () => {
    const { scores } = computePageRank([], []);
    expect(scores.size).toBe(0);
  });
});

describe('resolveSpecifier', () => {
  const files = new Set([
    'C:/repo/src/db.ts',
    'C:/repo/src/util/index.ts',
    'C:/repo/src/app.ts',
    'C:/repo/components/Button.tsx',
  ].map((p) => p.replace(/\//g, require('path').sep)));

  it('resolves a relative sibling with implicit .ts', () => {
    const r = resolveSpecifier('./db', 'C:/repo/src/app.ts'.replace(/\//g, require('path').sep), files);
    expect(r).toBeTruthy();
    expect(r!.endsWith('db.ts')).toBe(true);
  });

  it('resolves a directory to its index file', () => {
    const r = resolveSpecifier('./util', 'C:/repo/src/app.ts'.replace(/\//g, require('path').sep), files);
    expect(r).toBeTruthy();
    expect(r!.endsWith('index.ts')).toBe(true);
  });

  it('resolves a .js specifier to a .ts file (TS convention)', () => {
    const r = resolveSpecifier('./db.js', 'C:/repo/src/app.ts'.replace(/\//g, require('path').sep), files);
    expect(r).toBeTruthy();
    expect(r!.endsWith('db.ts')).toBe(true);
  });

  it('returns null for bare npm specifiers', () => {
    expect(resolveSpecifier('react', 'C:/repo/src/app.ts', files)).toBeNull();
    expect(resolveSpecifier('next/server', 'C:/repo/src/app.ts', files)).toBeNull();
  });

  it('returns null for unresolvable relative paths', () => {
    expect(resolveSpecifier('./nope', 'C:/repo/src/app.ts'.replace(/\//g, require('path').sep), files)).toBeNull();
  });

  it('resolves Next-style @/ aliases from the inferred repo root', () => {
    const repoRoot = 'C:/repo'.replace(/\//g, require('path').sep);
    const r = resolveSpecifier('@/components/Button', 'C:/repo/src/app.ts'.replace(/\//g, require('path').sep), files, repoRoot);
    expect(r).toBeTruthy();
    expect(r!.endsWith(`components${require('path').sep}Button.tsx`)).toBe(true);
  });

  it('infers a repo root from files across app and components folders', () => {
    const root = inferRepoRoot([...files]);
    expect(root).toBeTruthy();
    expect(root!.endsWith('repo')).toBe(true);
  });

  it('resolves tsconfig path aliases', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-resolver-'));
    try {
      fs.mkdirSync(path.join(repo, 'src', 'features'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@features/*': ['src/features/*'],
            '@core': ['src/core/index.ts']
          }
        }
      }));
      const feature = path.join(repo, 'src', 'features', 'Panel.ts');
      const core = path.join(repo, 'src', 'core', 'index.ts');
      fs.mkdirSync(path.dirname(core), { recursive: true });
      fs.writeFileSync(feature, 'export const Panel = 1;');
      fs.writeFileSync(core, 'export const core = 1;');
      const fileSet = new Set([feature, core].map((p) => path.normalize(p)));
      const resolver = loadTypeScriptResolver(repo);

      expect(resolveSpecifier('@features/Panel', path.join(repo, 'src', 'app.ts'), fileSet, repo, resolver)).toBe(path.normalize(feature));
      expect(resolveSpecifier('@core', path.join(repo, 'src', 'app.ts'), fileSet, repo, resolver)).toBe(path.normalize(core));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('resolves baseUrl imports only when they point at indexed files', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-baseurl-'));
    try {
      fs.mkdirSync(path.join(repo, 'src', 'lib'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: 'src' } }));
      const lib = path.join(repo, 'src', 'lib', 'thing.ts');
      fs.writeFileSync(lib, 'export const thing = 1;');
      const fileSet = new Set([path.normalize(lib)]);
      const resolver = loadTypeScriptResolver(repo);

      expect(resolveSpecifier('lib/thing', path.join(repo, 'src', 'app.ts'), fileSet, repo, resolver)).toBe(path.normalize(lib));
      expect(resolveSpecifier('react', path.join(repo, 'src', 'app.ts'), fileSet, repo, resolver)).toBeNull();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('resolves package exports and package imports maps', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-package-'));
    try {
      fs.mkdirSync(path.join(repo, 'src', 'api'), { recursive: true });
      fs.mkdirSync(path.join(repo, 'src', 'internal'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
        name: '@local/app',
        exports: {
          '.': './src/index.ts',
          './api/*': './src/api/*.ts'
        },
        imports: {
          '#internal/*': './src/internal/*.ts'
        }
      }));
      const index = path.join(repo, 'src', 'index.ts');
      const userApi = path.join(repo, 'src', 'api', 'user.ts');
      const secret = path.join(repo, 'src', 'internal', 'secret.ts');
      fs.writeFileSync(index, 'export const root = 1;');
      fs.writeFileSync(userApi, 'export const user = 1;');
      fs.writeFileSync(secret, 'export const secret = 1;');
      const fileSet = new Set([index, userApi, secret].map((p) => path.normalize(p)));
      const resolver = loadTypeScriptResolver(repo);

      expect(resolveSpecifier('@local/app', path.join(repo, 'src', 'app.ts'), fileSet, repo, resolver)).toBe(path.normalize(index));
      expect(resolveSpecifier('@local/app/api/user', path.join(repo, 'src', 'app.ts'), fileSet, repo, resolver)).toBe(path.normalize(userApi));
      expect(resolveSpecifier('#internal/secret', path.join(repo, 'src', 'app.ts'), fileSet, repo, resolver)).toBe(path.normalize(secret));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
