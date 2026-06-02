import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { scanRepository } from '../omnicode-mcp/src/engine/scanner';
import { indexProject } from '../omnicode-mcp/src/tools/index_project';
import { initDb, getDbPath } from '../omnicode-mcp/src/store/db';

describe('scanRepository', () => {
  it('excludes generated release artifacts and Next build chunks', () => {
    const repo = path.join(os.tmpdir(), `omnicode-scan-${crypto.randomBytes(6).toString('hex')}`);
    try {
      fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
      fs.mkdirSync(path.join(repo, 'assets', 'public', '_next', 'static', 'chunks'), { recursive: true });
      fs.mkdirSync(path.join(repo, 'decompiled', 'resources'), { recursive: true });
      fs.mkdirSync(path.join(repo, 'ZAMP-OMEGA', '$PLUGINSDIR', 'app-64'), { recursive: true });

      fs.writeFileSync(path.join(repo, 'src', 'live.ts'), 'export const live = true;');
      fs.writeFileSync(path.join(repo, 'assets', 'public', '_next', 'static', 'chunks', 'bundle.js'), 'function bundle() {}');
      fs.writeFileSync(path.join(repo, 'decompiled', 'resources', 'old.js'), 'function old() {}');
      fs.writeFileSync(path.join(repo, 'ZAMP-OMEGA', '$PLUGINSDIR', 'app-64', 'packed.js'), 'function packed() {}');

      const files = scanRepository(repo).map((f) => f.path);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(path.join(repo, 'src', 'live.ts'));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('indexProject stale cleanup', () => {
  it('removes generated files left over from older indexes', async () => {
    const repo = path.join(os.tmpdir(), `omnicode-stale-${crypto.randomBytes(6).toString('hex')}`);
    try {
      fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
      fs.mkdirSync(path.join(repo, 'assets', 'public', '_next', 'static', 'chunks'), { recursive: true });
      const livePath = path.join(repo, 'src', 'live.ts');
      const generatedPath = path.join(repo, 'assets', 'public', '_next', 'static', 'chunks', 'bundle.js');
      fs.writeFileSync(livePath, 'export function live() { return true; }');
      fs.writeFileSync(generatedPath, 'function generated() { return true; }');

      const db = initDb(repo);
      const staleId = 'stale-generated-file';
      db.prepare(`
        INSERT INTO files (id, path, lang, size, lines, hash)
        VALUES (?, ?, 'js', 1, 1, 'old')
      `).run(staleId, generatedPath);
      db.close();

      const result = await indexProject(repo);
      const freshDb = initDb(repo);
      const rows = freshDb.prepare(`SELECT path FROM files`).all() as Array<{ path: string }>;
      freshDb.close();

      expect(result.staleRemoved).toBe(1);
      expect(rows.map((row) => row.path)).toEqual([livePath]);
    } finally {
      try { initDb(repo).close(); } catch {}
      try { const dbPath = getDbPath(repo); if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch {}
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
