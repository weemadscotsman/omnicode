import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { getDbPath, initDb } from '../omnicode-mcp/src/store/db';
import { getRepoVisionGate } from '../omnicode-mcp/src/engine/repo_vision_gate';
import { blindspotReport } from '../omnicode-mcp/src/tools/blindspot_report';

let currentRepo: string | null = null;

function makeRepo() {
  currentRepo = path.join(os.tmpdir(), `omnicode-gate-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(currentRepo, { recursive: true });
  return currentRepo;
}

function insertFile(repo: string, fileName: string, parserMode: string, quality: number, languageName = 'typescript') {
  const db = initDb(repo);
  const filePath = path.join(repo, fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'export const x = 1;');
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO files (id, path, lang, size, lines, hash, parser_mode, parse_quality, language_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, filePath, 'ts', 1, 1, crypto.randomUUID(), parserMode, quality, languageName);
  return { db, id, filePath };
}

afterEach(() => {
  if (!currentRepo) return;
  try { initDb(currentRepo).close(); } catch {}
  try {
    const dbPath = getDbPath(currentRepo);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  } catch {}
  fs.rmSync(currentRepo, { recursive: true, force: true });
  currentRepo = null;
});

describe('repo vision repair gate', () => {
  it('allows destructive repair only when repo vision is clean', () => {
    const repo = makeRepo();
    insertFile(repo, 'src/app.ts', 'tree-sitter', 1);

    const gate = getRepoVisionGate(initDb(repo));
    expect(gate.risk).toBe('LOW');
    expect(gate.repairAllowed).toBe(true);
    expect(gate.destructiveAllowed).toBe(true);
  });

  it('allows suggestions but blocks destructive edits for fallback parser coverage', () => {
    const repo = makeRepo();
    insertFile(repo, 'src/app.py', 'fallback', 0.68, 'python');

    const gate = getRepoVisionGate(initDb(repo));
    expect(gate.risk).toBe('MEDIUM');
    expect(gate.suggestionAllowed).toBe(true);
    expect(gate.repairAllowed).toBe(true);
    expect(gate.destructiveAllowed).toBe(false);
    expect(gate.reasons.join(' ')).toContain('fallback-parsed');
  });

  it('blocks repair planning when parser confidence is too weak', () => {
    const repo = makeRepo();
    const { db, id } = insertFile(repo, 'src/broken.ts', 'none', 0.1);
    db.prepare(`INSERT INTO blindspots (id, file_id, reason) VALUES (?, ?, ?)`)
      .run(crypto.randomUUID(), id, 'UNSUPPORTED_EXTENSION|error|Unsupported extension: .wat|hint=add parser');

    const gate = getRepoVisionGate(initDb(repo));
    expect(gate.risk).toBe('HIGH');
    expect(gate.repairAllowed).toBe(false);
    expect(gate.destructiveAllowed).toBe(false);
  });

  it('surfaces the gate in blindspot_report', async () => {
    const repo = makeRepo();
    insertFile(repo, 'src/app.ts', 'fallback', 0.68);

    const report = await blindspotReport(repo);
    expect(report.result).toContain('Repair Gate: risk MEDIUM');
    expect(report.result).toContain('Destructive actions: BLOCK');
  });
});
