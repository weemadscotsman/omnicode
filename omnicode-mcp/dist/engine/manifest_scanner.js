"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readJsonLoose = readJsonLoose;
exports.scanRepoManifests = scanRepoManifests;
exports.summarizeManifestScan = summarizeManifestScan;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const MANIFEST_FILES = new Set(['package.json', 'tsconfig.json', 'jsconfig.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', 'venv', '.venv', '__pycache__', 'vendor', 'coverage']);
function stripJsonComments(input) {
    return input.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function readJsonLoose(filePath) {
    try {
        return JSON.parse(stripJsonComments(fs_1.default.readFileSync(filePath, 'utf8')));
    }
    catch {
        return null;
    }
}
function keysOfObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
}
function readPackage(filePath) {
    const json = readJsonLoose(filePath) ?? {};
    const workspaces = Array.isArray(json.workspaces)
        ? json.workspaces.map(String)
        : Array.isArray(json.workspaces?.packages)
            ? json.workspaces.packages.map(String)
            : [];
    return {
        kind: 'package',
        path: filePath,
        root: path_1.default.dirname(filePath),
        name: typeof json.name === 'string' ? json.name : undefined,
        workspaces,
        packageExports: keysOfObject(json.exports),
        packageImports: keysOfObject(json.imports),
    };
}
function readTsLike(filePath, kind) {
    const json = readJsonLoose(filePath) ?? {};
    const aliases = keysOfObject(json.compilerOptions?.paths);
    return { kind, path: filePath, root: path_1.default.dirname(filePath), aliases };
}
function readPyProject(filePath) {
    const text = fs_1.default.readFileSync(filePath, 'utf8');
    const name = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1];
    return { kind: 'pyproject', path: filePath, root: path_1.default.dirname(filePath), name };
}
function readCargo(filePath) {
    const text = fs_1.default.readFileSync(filePath, 'utf8');
    const name = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1];
    return { kind: 'cargo', path: filePath, root: path_1.default.dirname(filePath), name };
}
function readGoMod(filePath) {
    const text = fs_1.default.readFileSync(filePath, 'utf8');
    const name = text.match(/^\s*module\s+(.+)$/m)?.[1]?.trim();
    return { kind: 'go', path: filePath, root: path_1.default.dirname(filePath), name };
}
function readCsProj(filePath) {
    return { kind: 'csproj', path: filePath, root: path_1.default.dirname(filePath), name: path_1.default.basename(filePath, '.csproj') };
}
function isCodeFile(filePath) {
    return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(path_1.default.extname(filePath).toLowerCase());
}
function detectBarrel(filePath, repoRoot) {
    if (!isCodeFile(filePath))
        return null;
    const base = path_1.default.basename(filePath).toLowerCase();
    if (!['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'].includes(base))
        return null;
    let text = '';
    try {
        text = fs_1.default.readFileSync(filePath, 'utf8');
    }
    catch {
        return null;
    }
    const exports = [...text.matchAll(/\bexport\s+(?:\*\s+from|{[^}]+}\s+from)\s+['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    if (exports.length === 0)
        return null;
    return { path: filePath, root: repoRoot, exports };
}
function scanRepoManifests(repoPath, maxFiles = 20000) {
    const repoRoot = path_1.default.resolve(repoPath);
    const manifests = [];
    const barrels = [];
    let seenFiles = 0;
    const walk = (dir, depth) => {
        if (depth > 12 || seenFiles > maxFiles)
            return;
        let entries = [];
        try {
            entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const full = path_1.default.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name))
                    walk(full, depth + 1);
                continue;
            }
            if (!entry.isFile())
                continue;
            seenFiles++;
            if (entry.name.endsWith('.csproj'))
                manifests.push(readCsProj(full));
            else if (MANIFEST_FILES.has(entry.name)) {
                if (entry.name === 'package.json')
                    manifests.push(readPackage(full));
                else if (entry.name === 'tsconfig.json')
                    manifests.push(readTsLike(full, 'tsconfig'));
                else if (entry.name === 'jsconfig.json')
                    manifests.push(readTsLike(full, 'jsconfig'));
                else if (entry.name === 'pyproject.toml')
                    manifests.push(readPyProject(full));
                else if (entry.name === 'Cargo.toml')
                    manifests.push(readCargo(full));
                else if (entry.name === 'go.mod')
                    manifests.push(readGoMod(full));
            }
            const barrel = detectBarrel(full, repoRoot);
            if (barrel)
                barrels.push(barrel);
        }
    };
    walk(repoRoot, 0);
    return {
        manifests,
        packageRoots: manifests.filter((m) => ['package', 'pyproject', 'cargo', 'go', 'csproj'].includes(m.kind)),
        barrels,
    };
}
function summarizeManifestScan(scan, repoPath) {
    const byKind = new Map();
    for (const m of scan.manifests)
        byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + 1);
    const kindLine = [...byKind.entries()].map(([k, v]) => `${k}:${v}`).join(', ') || 'none';
    const packageLines = scan.packageRoots.slice(0, 12).map((m) => {
        const rel = path_1.default.relative(repoPath, m.path);
        const name = m.name ? ` name=${m.name}` : '';
        const workspace = m.workspaces?.length ? ` workspaces=${m.workspaces.join('|')}` : '';
        return `- ${m.kind} ${rel}${name}${workspace}`;
    });
    const barrelLines = scan.barrels.slice(0, 12).map((b) => `- ${path_1.default.relative(repoPath, b.path)} exports ${b.exports.join(', ')}`);
    return [
        `Manifest coverage: ${kindLine}`,
        `Package/workspace boundaries: ${scan.packageRoots.length}`,
        ...(packageLines.length ? packageLines : ['- none found']),
        `Barrel exports: ${scan.barrels.length}`,
        ...(barrelLines.length ? barrelLines : ['- none found']),
    ].join('\n');
}
