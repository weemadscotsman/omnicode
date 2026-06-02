import fs from 'fs';
import path from 'path';

export type ManifestKind = 'package' | 'tsconfig' | 'jsconfig' | 'pyproject' | 'cargo' | 'go' | 'csproj';

export interface ManifestInfo {
  kind: ManifestKind;
  path: string;
  root: string;
  name?: string;
  workspaces?: string[];
  aliases?: string[];
  packageExports?: string[];
  packageImports?: string[];
}

export interface BarrelExportInfo {
  path: string;
  root: string;
  exports: string[];
}

export interface RepoManifestScan {
  manifests: ManifestInfo[];
  packageRoots: ManifestInfo[];
  barrels: BarrelExportInfo[];
}

const MANIFEST_FILES = new Set(['package.json', 'tsconfig.json', 'jsconfig.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', 'venv', '.venv', '__pycache__', 'vendor', 'coverage']);

function stripJsonComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function readJsonLoose(filePath: string): Record<string, any> | null {
  try {
    return JSON.parse(stripJsonComments(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return null;
  }
}

function keysOfObject(value: any): string[] {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
}

function readPackage(filePath: string): ManifestInfo {
  const json = readJsonLoose(filePath) ?? {};
  const workspaces = Array.isArray(json.workspaces)
    ? json.workspaces.map(String)
    : Array.isArray(json.workspaces?.packages)
      ? json.workspaces.packages.map(String)
      : [];
  return {
    kind: 'package',
    path: filePath,
    root: path.dirname(filePath),
    name: typeof json.name === 'string' ? json.name : undefined,
    workspaces,
    packageExports: keysOfObject(json.exports),
    packageImports: keysOfObject(json.imports),
  };
}

function readTsLike(filePath: string, kind: 'tsconfig' | 'jsconfig'): ManifestInfo {
  const json = readJsonLoose(filePath) ?? {};
  const aliases = keysOfObject(json.compilerOptions?.paths);
  return { kind, path: filePath, root: path.dirname(filePath), aliases };
}

function readPyProject(filePath: string): ManifestInfo {
  const text = fs.readFileSync(filePath, 'utf8');
  const name = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1];
  return { kind: 'pyproject', path: filePath, root: path.dirname(filePath), name };
}

function readCargo(filePath: string): ManifestInfo {
  const text = fs.readFileSync(filePath, 'utf8');
  const name = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1];
  return { kind: 'cargo', path: filePath, root: path.dirname(filePath), name };
}

function readGoMod(filePath: string): ManifestInfo {
  const text = fs.readFileSync(filePath, 'utf8');
  const name = text.match(/^\s*module\s+(.+)$/m)?.[1]?.trim();
  return { kind: 'go', path: filePath, root: path.dirname(filePath), name };
}

function readCsProj(filePath: string): ManifestInfo {
  return { kind: 'csproj', path: filePath, root: path.dirname(filePath), name: path.basename(filePath, '.csproj') };
}

function isCodeFile(filePath: string): boolean {
  return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(path.extname(filePath).toLowerCase());
}

function detectBarrel(filePath: string, repoRoot: string): BarrelExportInfo | null {
  if (!isCodeFile(filePath)) return null;
  const base = path.basename(filePath).toLowerCase();
  if (!['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'].includes(base)) return null;
  let text = '';
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { return null; }
  const exports = [...text.matchAll(/\bexport\s+(?:\*\s+from|{[^}]+}\s+from)\s+['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
  if (exports.length === 0) return null;
  return { path: filePath, root: repoRoot, exports };
}

export function scanRepoManifests(repoPath: string, maxFiles = 20000): RepoManifestScan {
  const repoRoot = path.resolve(repoPath);
  const manifests: ManifestInfo[] = [];
  const barrels: BarrelExportInfo[] = [];
  let seenFiles = 0;

  const walk = (dir: string, depth: number) => {
    if (depth > 12 || seenFiles > maxFiles) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      seenFiles++;
      if (entry.name.endsWith('.csproj')) manifests.push(readCsProj(full));
      else if (MANIFEST_FILES.has(entry.name)) {
        if (entry.name === 'package.json') manifests.push(readPackage(full));
        else if (entry.name === 'tsconfig.json') manifests.push(readTsLike(full, 'tsconfig'));
        else if (entry.name === 'jsconfig.json') manifests.push(readTsLike(full, 'jsconfig'));
        else if (entry.name === 'pyproject.toml') manifests.push(readPyProject(full));
        else if (entry.name === 'Cargo.toml') manifests.push(readCargo(full));
        else if (entry.name === 'go.mod') manifests.push(readGoMod(full));
      }
      const barrel = detectBarrel(full, repoRoot);
      if (barrel) barrels.push(barrel);
    }
  };

  walk(repoRoot, 0);
  return {
    manifests,
    packageRoots: manifests.filter((m) => ['package', 'pyproject', 'cargo', 'go', 'csproj'].includes(m.kind)),
    barrels,
  };
}

export function summarizeManifestScan(scan: RepoManifestScan, repoPath: string): string {
  const byKind = new Map<string, number>();
  for (const m of scan.manifests) byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + 1);
  const kindLine = [...byKind.entries()].map(([k, v]) => `${k}:${v}`).join(', ') || 'none';
  const packageLines = scan.packageRoots.slice(0, 12).map((m) => {
    const rel = path.relative(repoPath, m.path);
    const name = m.name ? ` name=${m.name}` : '';
    const workspace = m.workspaces?.length ? ` workspaces=${m.workspaces.join('|')}` : '';
    return `- ${m.kind} ${rel}${name}${workspace}`;
  });
  const barrelLines = scan.barrels.slice(0, 12).map((b) => `- ${path.relative(repoPath, b.path)} exports ${b.exports.join(', ')}`);
  return [
    `Manifest coverage: ${kindLine}`,
    `Package/workspace boundaries: ${scan.packageRoots.length}`,
    ...(packageLines.length ? packageLines : ['- none found']),
    `Barrel exports: ${scan.barrels.length}`,
    ...(barrelLines.length ? barrelLines : ['- none found']),
  ].join('\n');
}
