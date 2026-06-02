// ───────────────────────────────────────────────────────────────────────────
// Real PageRank over the file import graph — replaces the old fake
// "incoming-edge count × 10" importance heuristic.
//
// Standard PageRank: damping 0.85, dangling-node mass redistribution,
// iterate to convergence (L1 delta < tol). Scores normalized to sum ≈ 1.0.
// ───────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import { readJsonLoose, scanRepoManifests } from './manifest_scanner';

const CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const PY_EXTS = ['.py'];
const RUST_EXTS = ['.rs'];
const GO_EXTS = ['.go'];
const CSHARP_EXTS = ['.cs'];
const RUBY_EXTS = ['.rb'];
const JVM_EXTS = ['.java', '.kt'];
const PHP_EXTS = ['.php'];
const C_EXTS = ['.h', '.hpp', '.hh', '.hxx', '.c', '.cc', '.cpp', '.cxx'];
const SWIFT_EXTS = ['.swift'];
const SOL_EXTS = ['.sol'];
const LUA_EXTS = ['.lua'];

type JsonObject = Record<string, any>;

export interface SpecifierResolver {
  repoRoot: string;
  configRoot: string;
  baseUrl?: string;
  paths: Array<{ pattern: string; targets: string[] }>;
  packageName?: string;
  packageExports?: JsonObject | string | string[];
  packageImports?: JsonObject;
  packageEntryTargets: string[];
}

function stripJsonComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readJson(filePath: string): JsonObject | null { return readJsonLoose(filePath); }

function readTsConfig(repoRoot: string): JsonObject | null {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const filePath = path.join(repoRoot, name);
    if (fs.existsSync(filePath)) return readJson(filePath);
  }
  return null;
}

function selectPackageTarget(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = selectPackageTarget(item);
      if (target) return target;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of ['import', 'require', 'default', 'node', 'browser', 'source', 'types']) {
      const target = selectPackageTarget(value[key]);
      if (target) return target;
    }
  }
  return null;
}

function matchPattern(specifier: string, pattern: string): string | null {
  const star = pattern.indexOf('*');
  if (star === -1) return specifier === pattern ? '' : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function applyTarget(target: string, capture: string): string {
  return target.includes('*') ? target.replace(/\*/g, capture) : target;
}

function resolveExportMap(map: any, subpath: string): string | null {
  if (!map) return null;
  if (typeof map === 'string' || Array.isArray(map)) return subpath === '.' ? selectPackageTarget(map) : null;
  if (typeof map !== 'object') return null;

  const direct = selectPackageTarget(map[subpath]);
  if (direct) return direct;

  for (const [pattern, value] of Object.entries(map)) {
    const capture = matchPattern(subpath, pattern);
    if (capture === null) continue;
    const target = selectPackageTarget(value);
    if (target) return applyTarget(target, capture);
  }
  return null;
}

export function loadTypeScriptResolver(repoRoot?: string): SpecifierResolver | undefined {
  if (!repoRoot) return undefined;
  const root = path.resolve(repoRoot);
  const tsConfig = readTsConfig(root);
  const compilerOptions = tsConfig?.compilerOptions ?? {};
  const baseUrl = compilerOptions.baseUrl
    ? path.resolve(root, compilerOptions.baseUrl)
    : (compilerOptions.paths ? root : undefined);
  const paths = Object.entries(compilerOptions.paths ?? {}).map(([pattern, value]) => ({
    pattern,
    targets: Array.isArray(value) ? value.map(String) : [String(value)],
  }));

  const packageJson = readJson(path.join(root, 'package.json'));
  const packageEntryTargets = [
    packageJson?.source,
    packageJson?.module,
    packageJson?.main,
    'src/index',
    'index',
  ].filter(Boolean).map(String);

  return {
    repoRoot: root,
    configRoot: root,
    baseUrl,
    paths,
    packageName: packageJson?.name,
    packageExports: packageJson?.exports,
    packageImports: packageJson?.imports,
    packageEntryTargets,
  };
}

export function loadTypeScriptResolvers(repoRoot?: string): SpecifierResolver[] {
  if (!repoRoot) return [];
  const root = path.resolve(repoRoot);
  const scan = scanRepoManifests(root);
  const configRoots = new Set<string>([root]);
  for (const manifest of scan.manifests) {
    if (manifest.kind === 'tsconfig' || manifest.kind === 'jsconfig' || manifest.kind === 'package') {
      configRoots.add(manifest.root);
    }
  }
  return [...configRoots]
    .map((configRoot) => {
      const resolver = loadTypeScriptResolver(configRoot);
      if (!resolver) return undefined;
      resolver.repoRoot = root;
      resolver.configRoot = configRoot;
      return resolver;
    })
    .filter((x): x is SpecifierResolver => !!x)
    .sort((a, b) => b.configRoot.length - a.configRoot.length);
}

export function resolverForFile(filePath: string, resolvers: SpecifierResolver[]): SpecifierResolver | undefined {
  const normalized = path.resolve(filePath).toLowerCase();
  return resolvers.find((resolver) => normalized.startsWith(resolver.configRoot.toLowerCase() + path.sep)) ?? resolvers[resolvers.length - 1];
}

function resolveCandidates(raw: string, fileSet: Set<string>, exts = CODE_EXTS, indexNames = ['index']): string | null {
  const candidates: string[] = [raw];
  for (const ext of exts) candidates.push(raw + ext);
  for (const indexName of indexNames) for (const ext of exts) candidates.push(path.join(raw, indexName + ext));
  if (raw.endsWith('.js')) {
    const stem = raw.slice(0, -3);
    candidates.push(stem + '.ts', stem + '.tsx');
  }

  for (const c of candidates) {
    const normalized = path.normalize(c);
    if (fileSet.has(normalized)) return normalized;
  }
  return null;
}

function modulePath(specifier: string): string {
  return specifier.replace(/\./g, path.sep).replace(/::/g, path.sep);
}

function resolvePythonSpecifier(specifier: string, fromFile: string, fileSet: Set<string>, repoRoot?: string): string | null {
  const baseDir = path.dirname(fromFile);
  if (specifier.startsWith('.')) {
    const dots = specifier.match(/^\.+/)?.[0].length ?? 0;
    const tail = specifier.slice(dots);
    let dir = baseDir;
    for (let i = 1; i < dots; i++) dir = path.dirname(dir);
    return resolveCandidates(path.join(dir, modulePath(tail || '__init__')), fileSet, PY_EXTS, ['__init__']);
  }
  if (!repoRoot) return null;
  return resolveCandidates(path.resolve(repoRoot, modulePath(specifier)), fileSet, PY_EXTS, ['__init__']);
}

function resolveRustSpecifier(specifier: string, fromFile: string, fileSet: Set<string>, repoRoot?: string): string | null {
  const baseDir = path.dirname(fromFile);
  if (specifier.startsWith('crate::') && repoRoot) {
    const tail = specifier.slice('crate::'.length);
    return resolveCandidates(path.resolve(repoRoot, 'src', modulePath(tail)), fileSet, RUST_EXTS, ['mod']);
  }
  if (specifier.startsWith('self::')) {
    return resolveCandidates(path.resolve(baseDir, modulePath(specifier.slice('self::'.length))), fileSet, RUST_EXTS, ['mod']);
  }
  if (specifier.startsWith('super::')) {
    return resolveCandidates(path.resolve(path.dirname(baseDir), modulePath(specifier.slice('super::'.length))), fileSet, RUST_EXTS, ['mod']);
  }
  if (/^[A-Za-z_]\w*$/.test(specifier)) {
    return resolveCandidates(path.resolve(baseDir, specifier), fileSet, RUST_EXTS, ['mod']);
  }
  return null;
}

function loadGoModules(repoRoot?: string): Array<{ module: string; root: string }> {
  if (!repoRoot) return [];
  const scan = scanRepoManifests(repoRoot);
  return scan.manifests
    .filter((m) => m.kind === 'go' && m.name)
    .map((m) => ({ module: m.name!, root: m.root }))
    .sort((a, b) => b.module.length - a.module.length);
}

function resolveGoSpecifier(specifier: string, fileSet: Set<string>, repoRoot?: string): string | null {
  for (const mod of loadGoModules(repoRoot)) {
    if (specifier === mod.module || specifier.startsWith(`${mod.module}/`)) {
      const tail = specifier === mod.module ? '' : specifier.slice(mod.module.length + 1);
      const packageDir = path.resolve(mod.root, tail);
      const resolved = resolveCandidates(packageDir, fileSet, GO_EXTS, []);
      if (resolved) return resolved;
      const packageFiles = [...fileSet].filter((file) =>
        path.extname(file).toLowerCase() === '.go' &&
        path.dirname(file).toLowerCase() === packageDir.toLowerCase()
      );
      if (packageFiles.length === 1) return packageFiles[0];
    }
  }
  return null;
}

// Ruby: `require_relative 'x'`, `require './lib/x'`, `require 'lib/foo'`. The
// extractor loses the require/require_relative distinction, so try the most
// specific resolution first (relative to file), then common load roots.
function resolveRubySpecifier(specifier: string, fromFile: string, fileSet: Set<string>, repoRoot?: string): string | null {
  const baseDir = path.dirname(fromFile);
  const rel = resolveCandidates(path.resolve(baseDir, specifier), fileSet, RUBY_EXTS, []);
  if (rel) return rel;
  if (repoRoot) {
    const fromRoot = resolveCandidates(path.resolve(repoRoot, specifier), fileSet, RUBY_EXTS, []);
    if (fromRoot) return fromRoot;
    for (const loadRoot of ['lib', 'app', 'app/models', 'app/controllers']) {
      const cand = resolveCandidates(path.resolve(repoRoot, loadRoot, specifier), fileSet, RUBY_EXTS, []);
      if (cand) return cand;
    }
  }
  // require_relative 'other' with a unique sibling basename in the repo.
  if (/^[A-Za-z_]\w*$/.test(specifier)) {
    const matches = [...fileSet].filter((f) => RUBY_EXTS.includes(path.extname(f).toLowerCase()) && path.basename(f, path.extname(f)) === specifier);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

// JVM (Java/Kotlin): `import com.foo.Bar` → a file at <root>/.../com/foo/Bar.(java|kt).
// JDK/library imports (java.util.*, kotlin.*) won't match local files → external.
function resolveJvmSpecifier(specifier: string, fileSet: Set<string>): string | null {
  const parts = specifier.split('.').filter(Boolean);
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1];
  // Wildcard import `com.foo.*` → resolve to the package dir if a single file sits there.
  if (last === '*') {
    const pkgDir = parts.slice(0, -1).join(path.sep).toLowerCase();
    const inPkg = [...fileSet].filter((f) => JVM_EXTS.includes(path.extname(f).toLowerCase()) && path.dirname(f).toLowerCase().endsWith(pkgDir));
    return inPkg.length === 1 ? inPkg[0] : null;
  }
  const pkgPath = parts.join(path.sep).toLowerCase();
  for (const ext of JVM_EXTS) {
    const suffix = (path.sep + pkgPath + ext).toLowerCase();
    const matches = [...fileSet].filter((f) => f.toLowerCase().endsWith(suffix));
    if (matches.length === 1) return matches[0];
  }
  // Fallback: unique class-name match anywhere (Kotlin files needn't mirror package as dir).
  const byName = [...fileSet].filter((f) => JVM_EXTS.includes(path.extname(f).toLowerCase()) && path.basename(f, path.extname(f)) === last);
  return byName.length === 1 ? byName[0] : null;
}

// composer.json PSR-4 autoload roots: { "App\\": "src/", "App\\Tests\\": "tests/" }.
// Cached per repoRoot (read once per index pass).
const composerCache = new Map<string, Array<{ prefix: string; dirs: string[] }>>();
function loadComposerPsr4(repoRoot: string): Array<{ prefix: string; dirs: string[] }> {
  if (composerCache.has(repoRoot)) return composerCache.get(repoRoot)!;
  const out: Array<{ prefix: string; dirs: string[] }> = [];
  const cj = readJsonLoose(path.join(repoRoot, 'composer.json')) as JsonObject | null;
  for (const block of [cj?.autoload?.['psr-4'], cj?.['autoload-dev']?.['psr-4']]) {
    if (!block || typeof block !== 'object') continue;
    for (const [prefix, dir] of Object.entries(block)) {
      const dirs = (Array.isArray(dir) ? dir : [dir]).map(String);
      out.push({ prefix: String(prefix).replace(/\\+$/, ''), dirs });
    }
  }
  out.sort((a, b) => b.prefix.length - a.prefix.length); // longest prefix wins
  composerCache.set(repoRoot, out);
  return out;
}

// PHP: PSR-4 `use App\Foo\Bar` → <psr4-dir>/Foo/Bar.php; relative require/include
// → file path; vendor/JDK-style → external. Falls back to namespace path-suffix
// and unique class-name match when composer.json is absent.
function resolvePhpSpecifier(specifier: string, fromFile: string, fileSet: Set<string>, repoRoot?: string): string | null {
  const baseDir = path.dirname(fromFile);
  // require/include with a path-like specifier.
  if (specifier.includes('/') || specifier.startsWith('.')) {
    const rel = resolveCandidates(path.resolve(baseDir, specifier), fileSet, PHP_EXTS, []);
    if (rel) return rel;
    if (repoRoot) {
      const fromRoot = resolveCandidates(path.resolve(repoRoot, specifier), fileSet, PHP_EXTS, []);
      if (fromRoot) return fromRoot;
    }
  }
  const ns = specifier.replace(/^\\+/, '');
  if (!repoRoot || !/[A-Za-z_]/.test(ns)) return null;

  for (const { prefix, dirs } of loadComposerPsr4(repoRoot)) {
    if (ns === prefix || ns.startsWith(prefix + '\\')) {
      const tail = ns === prefix ? '' : ns.slice(prefix.length + 1);
      const sub = tail.split('\\').join(path.sep);
      for (const dir of dirs) {
        const cand = resolveCandidates(path.resolve(repoRoot, dir, sub), fileSet, PHP_EXTS, []);
        if (cand) return cand;
      }
    }
  }
  // No composer match: try namespace-as-path suffix, then unique class basename.
  const tailPath = ns.split('\\').join(path.sep).toLowerCase();
  const suffixMatches = [...fileSet].filter((f) => f.toLowerCase().endsWith((path.sep + tailPath + '.php').toLowerCase()));
  if (suffixMatches.length === 1) return suffixMatches[0];
  const cls = ns.split('\\').pop();
  if (cls) {
    const byName = [...fileSet].filter((f) => path.extname(f).toLowerCase() === '.php' && path.basename(f, '.php') === cls);
    if (byName.length === 1) return byName[0];
  }
  return null;
}

// C/C++: quoted `#include "foo.h"` → resolve relative to the including file, then
// common include roots, then a unique basename match. Angle includes are never
// extracted (system/external). compile_commands.json support can layer on later.
function resolveCSpecifier(specifier: string, fromFile: string, fileSet: Set<string>, repoRoot?: string): string | null {
  const baseDir = path.dirname(fromFile);
  let r = resolveCandidates(path.resolve(baseDir, specifier), fileSet, C_EXTS, []);
  if (r) return r;
  if (repoRoot) {
    for (const root of ['', 'include', 'src', 'inc', 'lib']) {
      r = resolveCandidates(path.resolve(repoRoot, root, specifier), fileSet, C_EXTS, []);
      if (r) return r;
    }
  }
  const base = path.basename(specifier).toLowerCase();
  const matches = [...fileSet].filter((f) => C_EXTS.includes(path.extname(f).toLowerCase()) && path.basename(f).toLowerCase() === base);
  return matches.length === 1 ? matches[0] : null;
}

// Swift: `import ModuleName` → a SwiftPM target (Sources/<Module>/) or a top-level
// folder of that name. System frameworks (Foundation, UIKit, SwiftUI) → external.
// Intra-module Swift files don't import each other (same-module visibility), so
// the main win for Swift is symbol extraction; this resolves cross-module edges.
function resolveSwiftSpecifier(specifier: string, fileSet: Set<string>, repoRoot?: string): string | null {
  if (!repoRoot) return null;
  const module = specifier.split('.')[0];
  for (const base of [path.join('Sources', module), module]) {
    const dir = path.resolve(repoRoot, base).toLowerCase();
    const inDir = [...fileSet].filter((f) => SWIFT_EXTS.includes(path.extname(f).toLowerCase()) &&
      (path.dirname(f).toLowerCase() === dir || path.dirname(f).toLowerCase().startsWith(dir + path.sep)));
    if (inDir.length >= 1) {
      const named = inDir.find((f) => path.basename(f, '.swift').toLowerCase() === module.toLowerCase());
      return named || inDir[0];
    }
  }
  return null;
}

// Solidity: `import "./Token.sol"` → relative file; `import "@openzeppelin/..."`
// → external unless vendored under node_modules/. Kills the blockchain blindspot
// for contract source. (ABI JSON artifacts are classified separately as abi_runtime.)
function resolveSoliditySpecifier(specifier: string, fromFile: string, fileSet: Set<string>, repoRoot?: string): string | null {
  const baseDir = path.dirname(fromFile);
  if (specifier.startsWith('.')) {
    return resolveCandidates(path.resolve(baseDir, specifier), fileSet, SOL_EXTS, []);
  }
  if (repoRoot) {
    const direct = resolveCandidates(path.resolve(repoRoot, specifier), fileSet, SOL_EXTS, []);
    if (direct) return direct;
    const vendored = resolveCandidates(path.resolve(repoRoot, 'node_modules', specifier), fileSet, SOL_EXTS, []);
    if (vendored) return vendored;
  }
  return null;
}

// Lua: `require("a.b.c")` → a/b/c.lua (dots → path), searched from the file dir,
// repo root, and common roots (src/, lua/). Also handles slash-style requires.
function resolveLuaSpecifier(specifier: string, fromFile: string, fileSet: Set<string>, repoRoot?: string): string | null {
  const baseDir = path.dirname(fromFile);
  const rel = specifier.includes('/') ? specifier : specifier.split('.').join(path.sep);
  let r = resolveCandidates(path.resolve(baseDir, rel), fileSet, LUA_EXTS, ['init']);
  if (r) return r;
  if (repoRoot) {
    for (const root of ['', 'src', 'lua', 'lib']) {
      r = resolveCandidates(path.resolve(repoRoot, root, rel), fileSet, LUA_EXTS, ['init']);
      if (r) return r;
    }
  }
  // unique basename fallback (Roblox/flat layouts)
  const base = path.basename(rel).toLowerCase();
  const matches = [...fileSet].filter((f) => path.extname(f).toLowerCase() === '.lua' && path.basename(f, '.lua').toLowerCase() === base);
  return matches.length === 1 ? matches[0] : null;
}

function resolveCSharpSpecifier(specifier: string, fileSet: Set<string>, repoRoot?: string): string | null {
  if (!repoRoot || !/^[A-Z_]\w*(\.[A-Z_]\w*)*$/i.test(specifier)) return null;
  const raw = path.resolve(repoRoot, modulePath(specifier));
  const direct = resolveCandidates(raw, fileSet, CSHARP_EXTS, []);
  if (direct) return direct;
  const last = specifier.split('.').pop()?.toLowerCase();
  if (!last) return null;
  const matches = [...fileSet].filter((f) => path.extname(f).toLowerCase() === '.cs' && path.basename(f, '.cs').toLowerCase() === last);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Resolve an import specifier (as written in source) to an absolute file path
 * that exists in the indexed set. Returns null for unresolvable / bare (npm)
 * specifiers — we only rank intra-repo edges.
 */
export function resolveSpecifier(
  specifier: string,
  fromFile: string,
  fileSet: Set<string>,
  repoRoot?: string,
  resolver?: SpecifierResolver
): string | null {
  const baseDir = path.dirname(fromFile);
  const fromExt = path.extname(fromFile).toLowerCase();
  if (fromExt === '.py') return resolvePythonSpecifier(specifier, fromFile, fileSet, repoRoot);
  if (fromExt === '.rs') return resolveRustSpecifier(specifier, fromFile, fileSet, repoRoot);
  if (fromExt === '.go') return resolveGoSpecifier(specifier, fileSet, repoRoot);
  if (fromExt === '.cs') return resolveCSharpSpecifier(specifier, fileSet, repoRoot);
  if (fromExt === '.rb') return resolveRubySpecifier(specifier, fromFile, fileSet, repoRoot);
  if (fromExt === '.java' || fromExt === '.kt') return resolveJvmSpecifier(specifier, fileSet);
  if (fromExt === '.php') return resolvePhpSpecifier(specifier, fromFile, fileSet, repoRoot);
  if (C_EXTS.includes(fromExt)) return resolveCSpecifier(specifier, fromFile, fileSet, repoRoot);
  if (fromExt === '.swift') return resolveSwiftSpecifier(specifier, fileSet, repoRoot);
  if (fromExt === '.sol') return resolveSoliditySpecifier(specifier, fromFile, fileSet, repoRoot);
  if (fromExt === '.lua') return resolveLuaSpecifier(specifier, fromFile, fileSet, repoRoot);
  let raw: string | null = null;

  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    raw = path.resolve(baseDir, specifier);
  } else if (repoRoot && specifier.startsWith('@/')) {
    raw = path.resolve(repoRoot, specifier.slice(2));
  } else if (repoRoot && specifier.startsWith('~/')) {
    raw = path.resolve(repoRoot, specifier.slice(2));
  } else if (repoRoot && specifier.startsWith('src/')) {
    raw = path.resolve(repoRoot, specifier);
  }

  if (raw) return resolveCandidates(raw, fileSet);

  if (resolver) {
    for (const { pattern, targets } of resolver.paths) {
      const capture = matchPattern(specifier, pattern);
      if (capture === null) continue;
      for (const target of targets) {
        const base = resolver.baseUrl ?? resolver.repoRoot;
        const resolved = resolveCandidates(path.resolve(base, applyTarget(target, capture)), fileSet);
        if (resolved) return resolved;
      }
    }

    if (specifier.startsWith('#')) {
      const target = resolveExportMap(resolver.packageImports, specifier);
      if (target) {
        const resolved = resolveCandidates(path.resolve(resolver.configRoot, target), fileSet);
        if (resolved) return resolved;
      }
    }

    if (resolver.packageName && (specifier === resolver.packageName || specifier.startsWith(`${resolver.packageName}/`))) {
      const subpath = specifier === resolver.packageName ? '.' : `.${specifier.slice(resolver.packageName.length)}`;
      const target = resolveExportMap(resolver.packageExports, subpath);
      if (target) {
        const resolved = resolveCandidates(path.resolve(resolver.configRoot, target), fileSet);
        if (resolved) return resolved;
      }
      const tail = specifier === resolver.packageName ? '' : specifier.slice(resolver.packageName.length + 1);
      const candidates = tail ? [tail] : resolver.packageEntryTargets;
      for (const candidate of candidates) {
        const resolved = resolveCandidates(path.resolve(resolver.configRoot, candidate), fileSet);
        if (resolved) return resolved;
      }
    }

    if (resolver.baseUrl) {
      const resolved = resolveCandidates(path.resolve(resolver.baseUrl, specifier), fileSet);
      if (resolved) return resolved;
    }
  }

  // Bare npm specifiers are external and should not create repo edges.
  return null;
}

export function inferRepoRoot(files: string[]): string | undefined {
  if (files.length === 0) return undefined;
  const split = (p: string) => path.resolve(p).split(path.sep);
  const parts = split(path.dirname(files[0]));
  for (const file of files.slice(1)) {
    const next = split(path.dirname(file));
    let i = 0;
    while (i < parts.length && i < next.length && parts[i].toLowerCase() === next[i].toLowerCase()) i++;
    parts.length = i;
    if (parts.length === 0) return undefined;
  }
  return parts.length > 0 ? parts.join(path.sep) || path.sep : undefined;
}

export interface PageRankResult {
  scores: Map<string, number>;
  iterations: number;
}

/**
 * Compute PageRank from resolved directed edges (from → to, file paths).
 * @param files     full set of indexed file paths (graph nodes)
 * @param edges     resolved directed import edges [fromFile, toFile]
 */
export function computePageRank(
  files: string[],
  edges: Array<[string, string]>,
  damping = 0.85,
  maxIter = 100,
  tol = 1e-6
): PageRankResult {
  const n = files.length;
  if (n === 0) return { scores: new Map(), iterations: 0 };

  const fileSet = new Set(files);
  const outLinks = new Map<string, string[]>();
  const inLinks = new Map<string, string[]>();
  for (const f of files) { outLinks.set(f, []); inLinks.set(f, []); }

  const seen = new Set<string>();
  for (const [src, dst] of edges) {
    if (!fileSet.has(src) || !fileSet.has(dst) || src === dst) continue;
    const key = `${src} ${dst}`;
    if (seen.has(key)) continue;
    seen.add(key);
    outLinks.get(src)!.push(dst);
    inLinks.get(dst)!.push(src);
  }

  let scores = new Map<string, number>();
  for (const f of files) scores.set(f, 1 / n);

  let iterations = maxIter;
  for (let iter = 0; iter < maxIter; iter++) {
    // Dangling-node mass: nodes with no out-links redistribute uniformly.
    let danglingSum = 0;
    for (const f of files) if (outLinks.get(f)!.length === 0) danglingSum += scores.get(f)!;
    const danglingPerNode = (damping * danglingSum) / n;

    const next = new Map<string, number>();
    for (const f of files) {
      let rankSum = 0;
      for (const src of inLinks.get(f)!) {
        const outCount = outLinks.get(src)!.length;
        if (outCount > 0) rankSum += scores.get(src)! / outCount;
      }
      next.set(f, (1 - damping) / n + damping * rankSum + danglingPerNode);
    }

    let delta = 0;
    for (const f of files) delta += Math.abs(next.get(f)! - scores.get(f)!);
    scores = next;
    if (delta < tol) { iterations = iter + 1; break; }
  }

  return { scores, iterations };
}
