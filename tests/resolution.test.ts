import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { indexProject } = require('../omnicode-mcp/dist/tools/index_project');
const { resolveAll } = require('../omnicode-mcp/dist/tools/resolve_all');
const { repairPlan } = require('../omnicode-mcp/dist/tools/repair_plan');
const { initDb, getDbPath } = require('../omnicode-mcp/dist/store/db');

const REPO = path.join(os.tmpdir(), `omnicode-res-${Math.random().toString(36).slice(2)}`);

function w(rel: string, content: string | Buffer) {
  const full = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

let ledger: Record<string, { kind: string; state: string }> = {};
let coverage: any;
let resolverGaps: Record<string, number>;
let rubyImportResolved = false;
let phpImportResolved = false;
let cLocalResolved = false;
let cSystemExtracted = true;
let solLocalResolved = false;
let solOzExternal = false;
let luaResolved = false;

beforeAll(async () => {
  w('src/a.ts', `import { b } from './b';\nexport function a(){ return b(); }`);
  w('src/b.ts', `export function b(){ return 1; }`);
  w('src/dyn.ts', `export async function load(n: string){ return await import(n); }`);
  w('src/types.d.ts', `export type T = number;`);
  // Python package whose relative import DOES resolve — proves the Python resolver works.
  w('pkg/__init__.py', ``);
  w('pkg/helper.py', `def greet():\n    return 1`);
  w('pkg/main.py', `from .helper import greet\nimport os\ndef run():\n    return greet()`);
  // Ruby: require_relative resolves to a sibling → proves the Ruby resolver.
  w('lib/other.rb', `def other; end`);
  w('lib/main.rb', `require_relative 'other'\nrequire 'json'\ndef run; other; end`);
  // PHP: relative require resolves → proves the PHP resolver (Composer/PSR-4 + relative).
  w('php/helper.php', `<?php\nfunction help(){ return 1; }`);
  w('php/main.php', `<?php\nrequire_once './helper.php';\nfunction run(){ return help(); }`);
  // C/C++: quoted include resolves to a local header; <stdio.h> stays external.
  w('c/util.h', `int util(int x);`);
  w('c/util.c', `#include "util.h"\n#include <stdio.h>\nint util(int x){ return x; }`);
  // Swift: import resolves to a SwiftPM module + symbols extracted → resolved.
  w('Sources/Core/Core.swift', `public struct Engine { public func start() {} }`);
  w('Sources/App/main.swift', `import Foundation\nimport Core\nfunc run() { let e = Engine(); e.start() }`);
  // Solidity (ABI/runtime): relative import resolves, OpenZeppelin external, ABI JSON classified.
  w('contracts/IERC20.sol', `pragma solidity ^0.8.0;\ninterface IERC20 { function transfer(address to, uint256 amt) external returns (bool); }`);
  w('contracts/Token.sol', `pragma solidity ^0.8.0;\nimport "./IERC20.sol";\nimport "@openzeppelin/contracts/access/Ownable.sol";\ncontract Token is IERC20 {\n  event Minted(address indexed to);\n  function transfer(address to, uint256 amt) external returns (bool) { return true; }\n}`);
  w('abi/Token.abi.json', JSON.stringify([{ type: 'function', name: 'transfer' }, { type: 'event', name: 'Minted' }]));
  // Lua: require("util") resolves to a sibling module; functions extracted.
  w('lua/util.lua', `local M = {}\nfunction M.help() return 1 end\nreturn M`);
  w('lua/main.lua', `local util = require("util")\nlocal function run() return util.help() end`);
  // Ops/data files that used to be "unknown" kind — now classified.
  w('deploy.ps1', `Write-Host "deploy"`);
  w('place.rbxlx', `<roblox></roblox>`);
  // A source file the fallback genuinely can't read → NAMED native-grammar gap.
  w('Opaque.swift', `// only a comment, nothing to extract`);
  w('.env', `SECRET_KEY=abc123`);
  w('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
  w('README.md', `# hi`);
  w('vend.min.js', 'a'.repeat(600 * 1024)); // minified blob

  const r = await resolveAll(REPO, { write: true });
  coverage = r.coverage;
  resolverGaps = r.resolver_gaps;
  const db = initDb(REPO);
  const rows = db.prepare('SELECT f.path p, r.kind, r.state FROM resolution r JOIN files f ON f.id = r.file_id').all() as any[];
  const rb = db.prepare(`SELECT i.to_file_id t FROM imports i JOIN files f ON f.id = i.from_file_id WHERE f.path LIKE '%main.rb' AND i.specifier = 'other'`).get() as any;
  rubyImportResolved = !!(rb && rb.t);
  const php = db.prepare(`SELECT i.to_file_id t FROM imports i JOIN files f ON f.id = i.from_file_id WHERE f.path LIKE '%main.php' AND i.specifier LIKE '%helper.php'`).get() as any;
  phpImportResolved = !!(php && php.t);
  const cinc = db.prepare(`SELECT i.specifier s, i.to_file_id t FROM imports i JOIN files f ON f.id = i.from_file_id WHERE f.path LIKE '%util.c'`).all() as any[];
  cLocalResolved = cinc.some((x) => /util\.h/.test(x.s) && x.t);
  cSystemExtracted = cinc.some((x) => /stdio/.test(x.s)); // angle includes must NOT be extracted
  const sol = db.prepare(`SELECT i.specifier s, i.to_file_id t FROM imports i JOIN files f ON f.id = i.from_file_id WHERE f.path LIKE '%Token.sol'`).all() as any[];
  solLocalResolved = sol.some((x) => /IERC20/.test(x.s) && x.t);
  solOzExternal = sol.some((x) => /openzeppelin/i.test(x.s) && !x.t);
  const lua = db.prepare(`SELECT i.to_file_id t FROM imports i JOIN files f ON f.id = i.from_file_id WHERE f.path LIKE '%main.lua' AND i.specifier = 'util'`).get() as any;
  luaResolved = !!(lua && lua.t);
  db.close();
  ledger = {};
  for (const row of rows) ledger[path.basename(row.p)] = { kind: row.kind, state: row.state };
});

afterAll(() => {
  fs.rmSync(REPO, { recursive: true, force: true });
  const d = getDbPath(REPO); for (const x of [d, d + '-wal', d + '-shm']) { try { fs.unlinkSync(x); } catch { /* */ } }
});

describe('Zero Unknown Files — resolution ledger', () => {
  it('every discovered file is accounted for (no unknown black holes)', () => {
    expect(coverage.unknown).toBe(0);
    expect(coverage.total).toBeGreaterThanOrEqual(9);
  });

  it('resolves a clean source file fully', () => {
    expect(ledger['a.ts'].state).toBe('resolved_full');
    expect(ledger['b.ts'].state).toBe('resolved_full');
  });

  it('classifies a generated file by kind', () => {
    expect(ledger['types.d.ts'].kind).toBe('generated');
    expect(ledger['vend.min.js'].state).toBe('generated_excluded');
  });

  it('classifies a binary/asset file as metadata', () => {
    expect(ledger['logo.png'].kind).toBe('asset');
    expect(ledger['logo.png'].state).toBe('resolved_metadata');
  });

  it('classifies .env as unsafe_excluded (never a silent skip)', () => {
    expect(ledger['.env']).toBeDefined();
    expect(ledger['.env'].kind).toBe('secret_risk');
    expect(ledger['.env'].state).toBe('unsafe_excluded');
  });

  it('resolves a Python package fully (the Python resolver is credited, not ignored)', () => {
    expect(ledger['main.py'].state).toBe('resolved_full');
    expect(ledger['helper.py'].state).toBe('resolved_full');
  });

  it('resolves a Ruby require_relative to its sibling (the Ruby resolver is credited)', () => {
    expect(rubyImportResolved).toBe(true);
    expect(ledger['main.rb'].state).toMatch(/resolved_(full|partial)/);
  });

  it('resolves a PHP relative require (the PHP resolver is credited)', () => {
    expect(phpImportResolved).toBe(true);
    expect(ledger['main.php'].state).toMatch(/resolved_(full|partial)/);
  });

  it('resolves a C quoted include to a local header, and keeps <system> includes external', () => {
    expect(cLocalResolved).toBe(true);
    expect(cSystemExtracted).toBe(false);
    expect(ledger['util.c'].state).toMatch(/resolved_(full|partial)/);
    expect(ledger['util.h'].state).toMatch(/resolved_(full|partial)/);
  });

  it('resolves a Swift module import (import Core → Sources/Core) and extracts symbols', () => {
    expect(ledger['main.swift'].state).toMatch(/resolved_(full|partial)/);
    expect(ledger['Core.swift'].state).toMatch(/resolved_(full|partial)/);
  });

  it('resolves Solidity: relative import resolves, OpenZeppelin is external, ABI JSON classified', () => {
    expect(solLocalResolved).toBe(true);
    expect(solOzExternal).toBe(true);
    expect(ledger['Token.sol'].kind).toBe('source');
    expect(ledger['Token.sol'].state).toMatch(/resolved_(full|partial)/);
    expect(ledger['Token.abi.json'].kind).toBe('abi_runtime');
    expect(ledger['Token.abi.json'].state).toBe('resolved_metadata');
  });

  it('resolves a Lua require to a sibling module and treats Lua as source', () => {
    expect(luaResolved).toBe(true);
    expect(ledger['main.lua'].kind).toBe('source');
    expect(ledger['util.lua'].state).toMatch(/resolved_(full|partial)/);
  });

  it('classifies ops scripts and engine data files instead of leaving them "unknown"', () => {
    expect(ledger['deploy.ps1'].kind).toBe('config');
    expect(ledger['place.rbxlx'].kind).toBe('asset');
    expect(Object.values(ledger).every((v) => v.kind !== 'unknown')).toBe(true);
  });

  it('names a native-grammar gap for a source file the fallback cannot read', () => {
    expect(ledger['Opaque.swift'].state).toBe('resolver_missing');
    expect(Object.keys(resolverGaps).some((k) => /grammar/i.test(k))).toBe(true);
  });

  it('turns a dynamic import into requires_runtime', () => {
    expect(ledger['dyn.ts'].state).toBe('requires_runtime');
  });

  it('writes all six resolution reports', () => {
    for (const f of ['RESOLUTION_REPORT.md', 'resolution.json', 'unresolved.ndjson', 'resolver_gaps.md', 'artifact_manifest.json', 'source_coverage.json']) {
      expect(fs.existsSync(path.join(REPO, '.omnicode', f))).toBe(true);
    }
  });
});

describe('blindspot explorer', () => {
  const { blindspotExplorer } = require('../omnicode-mcp/dist/tools/blindspot_explorer');

  it('reports honest per-file rate, classes, and explained unresolved references', async () => {
    const r = await blindspotExplorer(REPO, { top: 10, explain: true });
    expect(r.result).toMatch(/the honest rate/);
    expect(r.result).toMatch(/Blindspot classes/);
    expect(r.result).toMatch(/Top \d+ unresolved references/);
    // dyn.ts has a dynamic import → a dynamic class should appear
    expect(r.result).toMatch(/DYNAMIC_(IMPORT|RUNTIME_REFERENCE)/);
    // bare external imports (e.g. 'os' in app.py) should be classed external
    expect(r.result).toMatch(/external_package/);
  });
});

describe('resolution gates destructive repair', () => {
  it('refuses to delete a resolver_missing (unresolved) file', async () => {
    await indexProject(REPO, null, { workers: 0 });
    const r = await repairPlan(REPO, { intent: 'delete', destructive: true, target: 'Opaque.swift' });
    expect(r.result).toMatch(/UNRESOLVED FILE|RESOLVER/i);
    expect(r.result).toMatch(/REFUSE DESTRUCTIVE/);
  });

  it('refuses to delete a requires_runtime file', async () => {
    const r = await repairPlan(REPO, { intent: 'delete', destructive: true, target: 'src/dyn.ts' });
    expect(r.result).toMatch(/REFUSE DESTRUCTIVE/);
  });
});
