import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OMNICODE_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-db-id-'));

const { indexProject } = await import('../dist/tools/index_project.js');
const { repoMap } = await import('../dist/tools/repo_map.js');
const { searchSymbols } = await import('../dist/tools/search_symbols.js');
const { getDbPath } = await import('../dist/store/db.js');

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-db-id-repo-'));
fs.writeFileSync(path.join(repo, 'index.ts'), 'export function routeMain() { return 1; }\n', 'utf8');

const slashVariant = repo.replace(/\\/g, '/');
const nativeVariant = path.resolve(repo);

assert.equal(getDbPath(slashVariant), getDbPath(nativeVariant));

const indexed = await indexProject(slashVariant, undefined, { workers: 0, force: true });
assert.equal(indexed.partialIndex, false);
assert.equal(indexed.totalIndexedFiles, 1);

const map = await repoMap(nativeVariant);
assert.ok(!map.result.includes('Repository not indexed or empty.'));
assert.ok(map.result.includes('index.ts'));

const search = await searchSymbols(nativeVariant, 'routeMain', 5);
assert.ok(!search.result.includes('No symbols indexed yet.'));
assert.ok(search.result.includes('routeMain'));

console.log('db path identity targeted tests passed');
