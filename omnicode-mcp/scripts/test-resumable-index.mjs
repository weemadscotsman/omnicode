import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OMNICODE_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-resume-db-'));

const { indexProject } = await import('../dist/tools/index_project.js');
const { initDb, getIndexMeta } = await import('../dist/store/db.js');

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-resume-repo-'));
for (let i = 0; i < 5; i++) {
  fs.writeFileSync(
    path.join(repo, `file${i}.ts`),
    `export function file${i}() { return ${i}; }\n`,
    'utf8',
  );
}

const first = await indexProject(repo, undefined, {
  workers: 0,
  maxIndexFilesPerRun: 2,
});
assert.equal(first.partialIndex, true);
assert.equal(first.scanStopReason, 'index_incomplete');
assert.equal(first.resume.state, 'in_progress');
assert.equal(first.resume.startedAt, 0);
assert.equal(first.resume.nextCursor, 2);
assert.equal(first.resume.total, 5);

let db = initDb(repo);
try {
  assert.equal(getIndexMeta(db, 'partial_index'), '1');
  assert.equal(getIndexMeta(db, 'scan_stop_reason'), 'index_incomplete');
  assert.equal(getIndexMeta(db, 'index_resume_state'), 'in_progress');
  assert.equal(getIndexMeta(db, 'index_resume_cursor'), '2');
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM files WHERE parser_mode != 'skipped'`).get().c, 2);
} finally {
  db.close();
}

const second = await indexProject(repo, undefined, {
  workers: 0,
});
assert.equal(second.partialIndex, false);
assert.equal(second.scanStopReason, null);
assert.equal(second.resume.state, 'complete');
assert.equal(second.resume.startedAt, 2);
assert.equal(second.resume.nextCursor, 5);
assert.equal(second.totalIndexedFiles, 5);

db = initDb(repo);
try {
  assert.equal(getIndexMeta(db, 'partial_index'), '0');
  assert.equal(getIndexMeta(db, 'scan_stop_reason'), '');
  assert.equal(getIndexMeta(db, 'index_resume_state'), 'complete');
  assert.equal(getIndexMeta(db, 'index_resume_cursor'), '5');
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM files WHERE parser_mode != 'skipped'`).get().c, 5);
} finally {
  db.close();
}

console.log('resumable index targeted tests passed');
