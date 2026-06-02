import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSpecifier } from '../dist/engine/pagerank.js';

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-resolvers-'));
const files = [];
function touch(rel) {
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, '', 'utf8');
  files.push(full);
  return full;
}

const pyMain = touch('pkg/main.py');
const pyUtil = touch('pkg/util.py');
const pyInit = touch('pkg/sub/__init__.py');
const rsMain = touch('src/main.rs');
const rsLib = touch('src/core/mod.rs');
const goMain = touch('cmd/app/main.go');
const goPkg = touch('internal/service/service.go');
const csMain = touch('App/Program.cs');
const csSvc = touch('App/Services/UserService.cs');
fs.writeFileSync(path.join(repo, 'go.mod'), 'module example.com/app\n', 'utf8');

const set = new Set(files);
assert.equal(resolveSpecifier('pkg.util', pyMain, set, repo), pyUtil);
assert.equal(resolveSpecifier('.sub', pyMain, set, repo), pyInit);
assert.equal(resolveSpecifier('crate::core', rsMain, set, repo), rsLib);
assert.equal(resolveSpecifier('core', rsMain, set, repo), rsLib);
assert.equal(resolveSpecifier('example.com/app/internal/service', goMain, set, repo), goPkg);
assert.equal(resolveSpecifier('App.Services.UserService', csMain, set, repo), csSvc);
assert.equal(resolveSpecifier('System.Text', csMain, set, repo), null);

console.log('resolver v2 targeted tests passed');
