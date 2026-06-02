import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-child-timeout-'));
const root = path.join(temp, 'root');
const repo = path.join(root, 'repo');
fs.mkdirSync(repo, { recursive: true });
fs.writeFileSync(path.join(repo, 'package.json'), '{"name":"timeout-fixture"}\n', 'utf8');
fs.writeFileSync(path.join(repo, 'index.ts'), 'export function main() { return 1; }\n', 'utf8');

const childScript = path.join(temp, 'hang-child.js');
fs.writeFileSync(childScript, 'setInterval(() => {}, 1000);', 'utf8');

const out = path.join(temp, 'out');
const result = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [
    'dist/cli.js',
    'sweep',
    root,
    '--out',
    out,
    '--max-projects',
    '1',
    '--repo-timeout-ms',
    '1000',
    '--project-detection',
    'loose',
    '--cache-policy',
    'delete-after-each',
    '--min-free-gb',
    '0',
    '--pause-ms',
    '0',
  ], {
    cwd: path.resolve('.'),
    env: { ...process.env, OMNICODE_BENCH_CHILD_PATH: childScript },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.on('error', reject);
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

assert.equal(result.code, 0);
const ndjson = fs.readFileSync(path.join(out, 'sweep-results.ndjson'), 'utf8').trim();
assert.ok(ndjson);
const row = JSON.parse(ndjson);
assert.equal(row.status, 'fail');
assert.match(row.error, /timed out after 1000ms/);
assert.ok(row.duration_ms < 10000);

console.log('benchmark child timeout targeted tests passed');
