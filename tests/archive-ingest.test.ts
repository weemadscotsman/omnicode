import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
const { resolveContainedPath, extractArchive, isArchivePath } = require('../omnicode-mcp/dist/engine/archive_loader');
const { indexProject } = require('../omnicode-mcp/dist/tools/index_project');
const { initDb, getDbPath } = require('../omnicode-mcp/dist/store/db');

const TMP = path.join(os.tmpdir(), `omnicode-arch-test-${Math.random().toString(36).slice(2)}`);
fs.mkdirSync(TMP, { recursive: true });
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

// Dependency-free CRC32 (so the hand-written zip passes yauzl's CRC validation).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Minimal STORED-mode (uncompressed) ZIP writer — byte-exact, real zip yauzl reads.
function makeZip(zipPath: string, entries: Array<{ name: string; content: string }>): void {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.content, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(0, 42 - 8); ch.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([ch, nameBuf]));
    offset += lh.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...local, centralBuf, eocd]));
}

describe('resolveContainedPath — zip-slip containment', () => {
  const root = path.resolve('C:/tmp/extract'.replace(/\//g, path.sep));
  it('allows a normal nested entry', () => {
    expect(resolveContainedPath(root, 'src/app.ts')).toBeTruthy();
  });
  it('blocks ../ traversal', () => {
    expect(resolveContainedPath(root, '../../etc/passwd')).toBeNull();
    expect(resolveContainedPath(root, 'a/../../b/escape.ts')).toBeNull();
  });
  it('blocks absolute and drive-qualified names', () => {
    expect(resolveContainedPath(root, '/etc/passwd')).toBeNull();
    expect(resolveContainedPath(root, 'C:/Windows/system32/x')).toBeNull();
  });
  it('blocks backslash traversal', () => {
    expect(resolveContainedPath(root, '..\\..\\evil.ts')).toBeNull();
  });
});

describe('isArchivePath', () => {
  it('detects archive extensions', () => {
    expect(isArchivePath('a.zip')).toBe(true);
    expect(isArchivePath('book.epub')).toBe(true);
    expect(isArchivePath('comic.cbz')).toBe(true);
    expect(isArchivePath('repo.tar.gz')).toBe(false);
    expect(isArchivePath('app.ts')).toBe(false);
  });
});

describe('extractArchive — real zip, real extraction, malicious entries handled', () => {
  it('extracts source files, skips junk, blocks traversal entries', async () => {
    const zipPath = path.join(TMP, 'project.zip');
    await makeZip(zipPath, [
      { name: 'src/index.ts', content: 'export function main(){ return 1; }' },
      { name: 'src/util.ts', content: 'export const helper = () => 42;' },
      { name: 'node_modules/dep/junk.js', content: 'module.exports = {};' }, // junk → skipped
      { name: '../escape.ts', content: 'export const evil = 1;' },           // zip-slip → blocked
    ]);
    const ex = await extractArchive(zipPath);
    expect(ex.filesExtracted).toBe(2); // only the two real src files
    expect(fs.existsSync(path.join(ex.dir, 'src', 'index.ts'))).toBe(true);
    // junk skipped, traversal blocked
    expect(ex.skipped.some((s: any) => s.reason === 'junk')).toBe(true);
    expect(ex.skipped.some((s: any) => s.reason === 'path_traversal_blocked')).toBe(true);
    // the escaped file must NOT exist next to the temp dir
    expect(fs.existsSync(path.join(path.dirname(ex.dir), 'escape.ts'))).toBe(false);
    fs.rmSync(ex.dir, { recursive: true, force: true });
  });
});

describe('indexProject on a .zip — end to end', () => {
  it('extracts and indexes a zip, finding its symbols', async () => {
    const zipPath = path.join(TMP, 'indexme.zip');
    await makeZip(zipPath, [
      { name: 'src/calc.ts', content: 'export function addNumbers(a: number, b: number){ return a + b; }' },
      { name: 'src/app.ts', content: 'import { addNumbers } from "./calc"; export const run = () => addNumbers(1, 2);' },
    ]);
    const r = await indexProject(zipPath, null, { workers: 0 });
    expect(r.archive).toBeTruthy();
    expect(r.archive.source).toBe(zipPath);
    expect(r.symbolsExtracted).toBeGreaterThanOrEqual(2);

    const db = initDb(r.archive.extractedTo);
    const names = db.prepare('SELECT name FROM symbols').all().map((s: any) => s.name);
    db.close();
    expect(names).toContain('addNumbers');
    expect(names).toContain('run');

    fs.rmSync(r.archive.extractedTo, { recursive: true, force: true });
    const d = getDbPath(r.archive.extractedTo);
    for (const x of [d, d + '-wal', d + '-shm']) { try { fs.unlinkSync(x); } catch { /* */ } }
  });
});
