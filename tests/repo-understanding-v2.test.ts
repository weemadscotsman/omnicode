import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { scanRepoManifests } from '../omnicode-mcp/src/engine/manifest_scanner';
import { parseSource } from '../omnicode-mcp/src/engine/parser';
import { initDb, getDbPath } from '../omnicode-mcp/src/store/db';
import { repairPlan } from '../omnicode-mcp/src/tools/repair_plan';
import { loadTypeScriptResolvers, resolverForFile, resolveSpecifier } from '../omnicode-mcp/src/engine/pagerank';

let repo: string | null = null;

function makeRepo() {
  repo = path.join(os.tmpdir(), `omnicode-v2-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(repo, { recursive: true });
  return repo;
}

afterEach(() => {
  if (!repo) return;
  try { initDb(repo).close(); } catch {}
  try {
    const dbPath = getDbPath(repo);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  } catch {}
  fs.rmSync(repo, { recursive: true, force: true });
  repo = null;
});

describe('manifest scanner', () => {
  it('detects project manifests, package boundaries, workspaces, and barrel exports', () => {
    const root = makeRepo();
    fs.mkdirSync(path.join(root, 'packages', 'ui', 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } }));
    fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "py-core"\n');
    fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "rust-core"\n');
    fs.writeFileSync(path.join(root, 'go.mod'), 'module example.com/root\n');
    fs.writeFileSync(path.join(root, 'packages', 'ui', 'ui.csproj'), '<Project />');
    fs.writeFileSync(path.join(root, 'packages', 'ui', 'package.json'), JSON.stringify({ name: '@root/ui' }));
    fs.writeFileSync(path.join(root, 'packages', 'ui', 'src', 'Button.ts'), 'export const Button = 1;');
    fs.writeFileSync(path.join(root, 'packages', 'ui', 'src', 'index.ts'), "export * from './Button';\n");

    const scan = scanRepoManifests(root);
    expect(scan.manifests.map((m) => m.kind)).toEqual(expect.arrayContaining(['package', 'tsconfig', 'pyproject', 'cargo', 'go', 'csproj']));
    expect(scan.packageRoots.some((m) => m.name === '@root/ui')).toBe(true);
    expect(scan.packageRoots.some((m) => m.workspaces?.includes('packages/*'))).toBe(true);
    expect(scan.barrels.length).toBe(1);
    expect(scan.barrels[0].exports).toEqual(['./Button']);
  });
});

describe('nested TypeScript resolver contexts', () => {
  it('uses the nearest package tsconfig for path aliases', () => {
    const root = makeRepo();
    const app = path.join(root, 'packages', 'app');
    fs.mkdirSync(path.join(app, 'src', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: '@root/app' }));
    fs.writeFileSync(path.join(app, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } }
    }));
    const target = path.join(app, 'src', 'lib', 'thing.ts');
    const from = path.join(app, 'src', 'main.ts');
    fs.writeFileSync(target, 'export const thing = 1;');
    fs.writeFileSync(from, "import { thing } from '@app/lib/thing';");

    const resolvers = loadTypeScriptResolvers(root);
    const resolver = resolverForFile(from, resolvers);
    expect(resolver?.configRoot).toBe(app);
    expect(resolveSpecifier('@app/lib/thing', from, new Set([path.normalize(target), path.normalize(from)]), root, resolver)).toBe(path.normalize(target));
  });
});

describe('dynamic warning and repair refusal', () => {
  it('classifies dynamic imports as runtime warnings', () => {
    const parsed = parseSource('dynamic.ts', "export async function load(name:string){ return import(name); }");
    expect(parsed.blindspots.some((b) => b.startsWith('DYNAMIC_RUNTIME_REFERENCE|warn|'))).toBe(true);
  });

  it('refuses destructive repair when blindspots are blocking', async () => {
    const root = makeRepo();
    const db = initDb(root);
    const filePath = path.join(root, 'src', 'weak.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'export const weak = 1;');
    const fileId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO files (id, path, lang, size, lines, hash, parser_mode, parse_quality, language_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(fileId, filePath, 'ts', 1, 1, 'hash', 'none', 0.1, 'typescript');
    db.prepare(`INSERT INTO blindspots (id, file_id, reason) VALUES (?, ?, ?)`)
      .run(crypto.randomUUID(), fileId, 'UNSUPPORTED_EXTENSION|error|Unsupported extension|hint=add parser');
    db.close();

    const plan = await repairPlan(root, { intent: 'delete', target: 'weak', destructive: true });
    expect(plan.result).toContain('REFUSE DESTRUCTIVE REPAIR');
    expect(plan.result).toContain('Forbidden now');
    expect(plan.result).toContain('No code repairs were performed');
    expect(fs.existsSync(path.join(root, '.omnicode', 'NO_SPAGHETT_REPAIR_HANDOFF.md'))).toBe(true);
    const handoff = fs.readFileSync(path.join(root, '.omnicode', 'NO_SPAGHETT_REPAIR_HANDOFF.md'), 'utf8');
    expect(handoff).toContain('Mutation policy: NO CODE CHANGES WERE PERFORMED BY NO SPAGHETT');
    expect(handoff).toContain('advisory handoff');
  });

  it('writes a repo-local markdown handoff and rejects output outside the repo', async () => {
    const root = makeRepo();
    const db = initDb(root);
    const filePath = path.join(root, 'src', 'safe.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'export const safe = 1;');
    db.prepare(`
      INSERT INTO files (id, path, lang, size, lines, hash, parser_mode, parse_quality, language_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), filePath, 'ts', 1, 1, 'hash', 'tree-sitter', 1, 'typescript');
    db.close();

    const plan = await repairPlan(root, { intent: 'general', output_path: 'docs/HANDOFF.md' });
    expect(plan.result).toContain(path.join(root, 'docs', 'HANDOFF.md'));
    expect(fs.existsSync(path.join(root, 'docs', 'HANDOFF.md'))).toBe(true);
    expect(fs.readFileSync(path.join(root, 'docs', 'HANDOFF.md'), 'utf8')).toContain('No Spaghett does not apply patches');
    await expect(repairPlan(root, { output_path: '../outside.md' })).rejects.toThrow(/inside the repository/);
  });
});
