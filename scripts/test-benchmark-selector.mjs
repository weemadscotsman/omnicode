import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { benchmarkRepo } from '../dist/tools/benchmark.js';

process.env.OMNICODE_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-bench-selector-db-'));

function makeRepo(name) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `omnicode-${name}-`));
  return repo;
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function fileOutlineOp(result) {
  return result.operations.find((op) => op.operation === 'file_outline');
}

const hugeArchiveRepo = makeRepo('huge-archive');
write(path.join(hugeArchiveRepo, 'src', 'app.ts'), 'export function app() { return "ok"; }\n');
fs.writeFileSync(path.join(hugeArchiveRepo, 'payload.zip'), Buffer.alloc(1024 * 1024, 1));
const hugeResult = await benchmarkRepo(hugeArchiveRepo, { write: false });
const hugeOutline = fileOutlineOp(hugeResult);
assert.equal(hugeOutline.skipped, undefined);
assert.match(hugeOutline.notes, /src[\\/]app\.ts/);
assert.ok(hugeOutline.baseline_bytes < 1024 * 1024);
assert.ok(hugeResult.anomalies.some((a) => String(a).startsWith('largest_file_skipped_artifact:')));
assert.ok(hugeResult.anomalies.includes('file_outline_selector:source_only'));

const archiveOnlyRepo = makeRepo('archive-only');
fs.writeFileSync(path.join(archiveOnlyRepo, 'payload.zip'), Buffer.alloc(4096, 1));
const archiveOnlyResult = await benchmarkRepo(archiveOnlyRepo, { write: false });
const archiveOnlyOutline = fileOutlineOp(archiveOnlyResult);
assert.equal(archiveOnlyOutline.skipped, true);
assert.equal(archiveOnlyOutline.skip_reason, 'file_outline_skipped:no_parseable_source_file');
assert.ok(archiveOnlyResult.anomalies.includes('file_outline_skipped:no_parseable_source'));

const generatedRepo = makeRepo('generated');
write(path.join(generatedRepo, 'src', 'real.ts'), 'export function real() { return 1; }\n');
write(path.join(generatedRepo, 'src', 'bundle.min.js'), 'function fake(){}'.repeat(10_000));
const generatedResult = await benchmarkRepo(generatedRepo, { write: false });
const generatedOutline = fileOutlineOp(generatedResult);
assert.match(generatedOutline.notes, /src[\\/]real\.ts/);
assert.ok(generatedOutline.baseline_bytes < fs.statSync(path.join(generatedRepo, 'src', 'bundle.min.js')).size);

console.log('benchmark selector tests passed');
