import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexProject } from '../dist/tools/index_project.js';
import { getFileContext } from '../dist/tools/get_file_context.js';
import { applyOutputBudget } from '../dist/engine/output_budget.js';
import { getSessionStats } from '../dist/telemetry.js';
import { TOOL_DEFINITIONS } from '../dist/tool_registry.js';
import { loadOmniCodeConfig } from '../dist/engine/config.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-token-layer-'));
const repo = path.join(root, 'repo');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.writeFileSync(path.join(repo, 'src', 'b.ts'), 'export function beta() { return 42; }\n', 'utf8');
fs.writeFileSync(path.join(repo, 'src', 'a.ts'), "import { beta } from './b';\nexport function alpha() { return beta(); }\n", 'utf8');
fs.writeFileSync(path.join(repo, 'token-saver.config.json'), JSON.stringify({
  projectRoot: repo,
  ignorePatterns: ['**/ignored/**'],
}, null, 2), 'utf8');

process.env.OMNICODE_DB_DIR = path.join(root, 'db');
await indexProject(repo, undefined, { maxFiles: 20, maxBytes: 100_000, maxScanMs: 30_000 });

const ctx = await getFileContext(repo, 'src/a.ts', 4000, 4);
assert.match(ctx.result, /requested_file: src\/a\.ts/);
assert.match(ctx.result, /DIRECT DEPENDENCY: src\/b\.ts/);

const names = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));
assert.ok(names.has('get_file_context'));
assert.ok(names.has('token_savings_stats'));
const config = loadOmniCodeConfig(repo);
assert.equal(config.projectRoot, repo);
assert.deepEqual(config.ignorePatterns, ['**/ignored/**']);

process.env.OMNICODE_OUTPUT_MODE = 'active';
process.env.OMNICODE_MAX_RESPONSE_TOKENS = '600';
process.env.OMNICODE_SUMMARY_TOKENS = '120';
const big = 'x'.repeat(5000);
const budgeted = applyOutputBudget('repo_map', repo, { content: [{ type: 'text', text: big }] });
const text = budgeted.content[0].text;
assert.match(text, /OmniCode output budget active/);
assert.match(text, /Full redacted output artifact:/);

const stats = getSessionStats();
assert.equal(stats.artifactCount, 1);
assert.ok(stats.tokensSuppressed > 0);

console.log('token layer tests passed');
