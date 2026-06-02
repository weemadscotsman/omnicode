import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { appendMemoryEvent, readRecentMemory, summarizeMemory } from '../dist/engine/session_memory.js';
import { getVisibleToolDefinitions, TOOL_DEFINITIONS } from '../dist/tool_registry.js';
import { sessionResumeBrief } from '../dist/tools/session_resume_brief.js';
import { repairPlan } from '../dist/tools/repair_plan.js';

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-trust-'));
fs.writeFileSync(path.join(repo, 'index.ts'), 'export function main() { return "ok"; }\n', 'utf8');

process.env.OMNICODE_TOOL_MODE = 'compressed';
assert.deepEqual(getVisibleToolDefinitions().map((tool) => tool.name), [
  'skill_search',
  'skill_load',
  'skill_pack_for_task',
  'health_check',
  'list_tools',
  'get_tool_schema',
  'invoke_tool',
  'session_resume_brief',
]);

process.env.OMNICODE_TOOL_MODE = 'full';
assert.ok(getVisibleToolDefinitions().length >= TOOL_DEFINITIONS.length);
process.env.OMNICODE_TOOL_MODE = 'debug';
assert.ok(getVisibleToolDefinitions().some((tool) => tool.name === 'runtime_telemetry'));

const first = appendMemoryEvent(repo, {
  type: 'user.decision',
  summary: 'Never store ghp_abcdefghijklmnopqrstuvwxyz1234567890ABC raw secrets.',
  source: 'test',
});
appendMemoryEvent(repo, {
  type: 'risky_file.marked',
  summary: 'index.ts is risky until indexed.',
  data: { path: 'index.ts' },
  source: 'test',
});

const memoryPath = path.join(repo, '.omnicode', 'memory.jsonl');
const linesAfterTwo = fs.readFileSync(memoryPath, 'utf8').trim().split(/\r?\n/);
assert.equal(linesAfterTwo.length, 2);
assert.notEqual(linesAfterTwo[0].includes('ghp_abcdefghijklmnopqrstuvwxyz1234567890ABC'), true);
assert.equal(readRecentMemory(repo, 10)[0].id, first.id);
assert.equal(summarizeMemory(repo).riskyFiles[0], 'index.ts');

const briefNoIndex = JSON.parse((await sessionResumeBrief(repo)).result);
assert.equal(briefNoIndex.repo.path, repo);
assert.equal(briefNoIndex.indexed_state.indexed_files, 0);
assert.ok(briefNoIndex.forbidden_actions.includes('Do not perform destructive repair without stronger repo vision.'));

const handoff = await repairPlan(repo, { intent: 'delete', destructive: true, output_path: '.omnicode/TRUST_HANDOFF.md' });
assert.ok(handoff.result.includes('No code repairs were performed.'));
assert.ok(fs.existsSync(path.join(repo, '.omnicode', 'TRUST_HANDOFF.md')));
assert.ok(summarizeMemory(repo).latestRepairRefusal);

await mcpRoundTrip(repo);
await isolatedBenchmarkChild(repo);

console.log('trust-layer targeted tests passed');

async function mcpRoundTrip(repoPath) {
  process.env.OMNICODE_TOOL_MODE = 'compressed';
  process.env.OMNICODE_ROLE = 'read-only';
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: path.resolve('.'),
    env: { ...process.env, OMNICODE_TOOL_MODE: 'compressed', OMNICODE_ROLE: 'read-only' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });

  let nextId = 1;
  const call = (method, params = {}) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'trust-test', version: '0.0.0' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

  const list = await call('tools/list');
  assert.deepEqual(list.result.tools.map((tool) => tool.name), [
    'skill_search',
    'skill_load',
    'skill_pack_for_task',
    'health_check',
    'list_tools',
    'get_tool_schema',
    'invoke_tool',
    'session_resume_brief',
  ]);

  const schema = await call('tools/call', { name: 'get_tool_schema', arguments: { tool_name: 'benchmark' } });
  assert.equal(schema.result.isError, undefined);
  const schemaText = schema.result.content[0].text;
  assert.ok(schemaText.includes('"name": "benchmark"'));
  assert.ok(!schemaText.includes('"tools":'));

  const bench = await call('tools/call', {
    name: 'invoke_tool',
    arguments: {
      tool_name: 'benchmark',
      tool_input: { path: repoPath, max_files: 5, max_scan_ms: 5000, query: 'main', write: false },
    },
  });
  assert.equal(bench.result.isError, undefined);
  assert.ok(bench.result.content[0].text.includes('# OmniCode Benchmark'));

  const denied = await call('tools/call', { name: 'invoke_tool', arguments: { tool_name: 'index_project', tool_input: { path: repoPath } } });
  assert.equal(denied.result.isError, true);

  child.kill();
}

async function isolatedBenchmarkChild(repoPath) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/bench_child.js', '--repo', repoPath, '--max-files', '5', '--max-scan-ms', '5000'], {
      cwd: path.resolve('.'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || `bench_child exited ${code}`));
      else resolve(JSON.parse(stdout));
    });
  });
  assert.equal(result.benchmark_version, '2.0.0');
  assert.equal(result.repo_path, repoPath);
}
