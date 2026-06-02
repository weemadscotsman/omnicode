import Database from 'better-sqlite3';
import path from 'path';

// ── Zero Unknown Files: every discovered file ends in exactly one state ──────
// "Skip" is not a final state. A file is either resolved (to whatever depth is
// possible), classified as a non-source artifact with proof, or flagged with the
// NAMED thing it needs to be understood (a resolver, a runtime, a fix). No black holes.

export type ResolutionState =
  | 'resolved_full'        // parsed, indexed, imports resolved
  | 'resolved_partial'     // parsed enough for symbols/imports, with caveats
  | 'resolved_metadata'    // not parsed as code, but classified and recorded
  | 'generated_excluded'   // proven generated/bundle/vendor artifact
  | 'unsafe_excluded'      // secret/credential/symlink risk — logged, not exposed
  | 'requires_runtime'     // needs ABI/runtime/LSP/execution to fully understand
  | 'resolver_missing'     // a specific named resolver is needed
  | 'failed_with_reason';  // failed, but the error + next fix are recorded

export type FileKind =
  | 'source' | 'test' | 'config' | 'route' | 'schema' | 'abi_runtime'
  | 'generated' | 'asset' | 'binary' | 'docs' | 'secret_risk' | 'unknown';

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.cs', '.java', '.kt', '.php', '.rb', '.swift', '.c', '.h', '.cpp', '.hpp', '.sol', '.lua']);
const SCRIPT_EXT = new Set(['.ps1', '.psm1', '.sh', '.bash', '.zsh', '.fish', '.bat', '.cmd']);
const DOC_EXT = new Set(['.md', '.mdx', '.rst', '.txt', '.adoc']);
const ASSET_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.mov', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.rbxlx', '.rbxl', '.rbxm', '.rbxmx', '.fbx', '.obj', '.glb', '.gltf', '.blend']);
const BINARY_EXT = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.o', '.a', '.class', '.pyc', '.node', '.zip', '.gz', '.tar', '.7z', '.pdf']);
const SCHEMA_EXT = new Set(['.graphql', '.gql', '.prisma', '.proto']);
const CONFIG_EXT = new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.env', '.lock', '.xml']);

// Languages with a working import resolver (resolveSpecifier in pagerank.ts).
// For these, bare specifiers are external and only local/alias imports are gaps.
const HAS_RESOLVER = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.cs', '.rb', '.java', '.kt', '.php', '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hh', '.hxx', '.swift', '.sol', '.lua']);
const SOURCE_LIKE_KINDS = new Set<FileKind>(['source', 'route', 'test']);

const SECRET_NAME = /(^|\/)(\.env(\.[\w-]+)?|.*\.pem|.*\.key|id_rsa|id_ed25519|.*\.p12|.*\.pfx|.*\.keystore|credentials(\.json)?|secrets?(\.[\w]+)?)$/i;
const SECRET_HINT = /(secret|credential|private[_-]?key|apikey|api[_-]?key)/i;
const TEST_NAME = /(\.|_|^)(test|spec)\.[\w]+$|(^|\/)(tests?|__tests__|spec)(\/|$)|_test\.go$/i;
const SCHEMA_NAME = /(openapi|swagger)\.(ya?ml|json)$|schema\.(graphql|gql|prisma|json)$/i;
// ABI/runtime ARTIFACTS (JSON/configs/migrations) — NOT .sol source, which is a
// first-class resolved language (kind 'source') handled by the Solidity resolver.
const ABI_NAME = /\.abi\.json$|(^|\/)(abi|artifacts?)(\/|$)|hardhat\.config|truffle-config|foundry\.toml/i;
const CONFIG_NAME = /(^|\/)(package\.json|tsconfig.*\.json|jsconfig\.json|pyproject\.toml|go\.mod|go\.sum|cargo\.toml|.*\.csproj|pom\.xml|build\.gradle.*|requirements\.txt|pipfile|.*\.config\.[jt]s|vite\.config\.|next\.config\.|webpack\.config\.)/i;
const ROUTE_NAME = /(^|\/)(app|pages|routes?|api)(\/).*(\/(page|route|layout|index)\.[jt]sx?$|\.[jt]sx?$)|(^|\/)server\/.*(route|handler)/i;
const LOCK_NAME = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|cargo\.lock|composer\.lock|gemfile\.lock)$/i;
const GENERATED_HINT = /(^|\/)(dist|build|out|\.next|_next|node_modules|vendor|generated|coverage|\.turbo|__pycache__|target)(\/|$)|\.min\.(js|css)$|\.bundle\.js$|\.d\.ts$|\.generated\./i;

export function classifyFileKind(relPath: string): FileKind {
  const lower = relPath.toLowerCase();
  const ext = path.extname(lower);
  if (SECRET_NAME.test(lower) || (SECRET_HINT.test(lower) && (ext === '.json' || ext === '.txt' || ext === ''))) return 'secret_risk';
  if (GENERATED_HINT.test(lower) || LOCK_NAME.test(lower)) return 'generated';
  if (ABI_NAME.test(lower)) return 'abi_runtime';
  if (SCHEMA_NAME.test(lower) || SCHEMA_EXT.has(ext)) return 'schema';
  if (TEST_NAME.test(lower)) return 'test';
  if (ROUTE_NAME.test(lower) && SOURCE_EXT.has(ext)) return 'route';
  if (CONFIG_NAME.test(lower) || (CONFIG_EXT.has(ext) && !SOURCE_EXT.has(ext))) return 'config';
  if (SCRIPT_EXT.has(ext)) return 'config'; // ops/shell scripts — classified, not "unknown"
  if (DOC_EXT.has(ext)) return 'docs';
  if (ASSET_EXT.has(ext)) return 'asset';
  if (BINARY_EXT.has(ext)) return 'binary';
  if (SOURCE_EXT.has(ext)) return 'source';
  return 'unknown';
}

// Per-extension resolver requirement — names the EXACT thing missing, not "blindspot".
function resolverRequirementFor(ext: string): string {
  const map: Record<string, string> = {
    '.py': 'python resolver (pyproject.toml / import roots)',
    '.go': 'go resolver (go.mod / package graph)',
    '.rs': 'rust resolver (Cargo.toml / mod/use)',
    '.cs': 'c# resolver (.csproj / namespaces)',
    '.java': 'jvm resolver (Gradle/Maven / packages)',
    '.kt': 'jvm resolver (Gradle/Maven / packages)',
    '.php': 'php resolver (composer / namespaces)',
    '.rb': 'ruby resolver (Gemfile / require paths)',
    '.swift': 'swift resolver (Package.swift / modules)',
    '.c': 'c/c++ resolver (include paths / build system)',
    '.cpp': 'c/c++ resolver (include paths / build system)',
    '.h': 'c/c++ resolver (include paths / build system)',
    '.hpp': 'c/c++ resolver (include paths / build system)',
  };
  return map[ext] || `native grammar/resolver for ${ext || 'this file type'}`;
}

// Distinct from a missing import resolver: this names a missing native tree-sitter
// grammar (deep symbol extraction), the last polish rung of the ladder.
function grammarRequirementFor(ext: string): string {
  const lang: Record<string, string> = {
    '.swift': 'swift', '.kt': 'kotlin', '.java': 'java', '.rb': 'ruby', '.php': 'php',
    '.c': 'c', '.h': 'c', '.cpp': 'c++', '.hpp': 'c++',
  };
  return `a native ${lang[ext] || ext.replace('.', '') || 'language'} grammar`;
}

export interface ResolutionRow {
  file_id: string;
  kind: FileKind;
  state: ResolutionState;
  reason: string;
  resolver_used: string;
  confidence: number;
}

interface FileFacts {
  file_id: string;
  path: string;
  lang: string;
  parser_mode: string;
  parse_quality: number;
  symbol_count: number;
  unresolved_local: number;   // unresolved relative/alias imports (gaps for resolver-backed langs)
  total_imports: number;      // all extracted imports
  total_unresolved: number;   // all unresolved imports (gaps for no-resolver langs)
  dynamic_count: number;
  parse_error: number;     // PARSE_ERROR/DEGRADED_PARSE present
  hard_fail: number;       // PARSE_FAILURE/UNSUPPORTED_EXTENSION present
  skip_reason: string | null; // from "skipped:<reason>" blindspot
}

/** Map one file's facts → a single resolution state with proof + confidence. */
export function deriveResolution(f: FileFacts): ResolutionRow {
  const rel = f.path;
  const ext = path.extname(rel).toLowerCase();
  const kind = classifyFileKind(rel);

  // 1. Security first — never expose, always log.
  if (kind === 'secret_risk') {
    return row(f, kind, 'unsafe_excluded', 'secret/credential-risk file — content withheld and logged', 'security_classifier', 1);
  }

  // 2. Skipped-at-scan artifacts (parser_mode = 'skipped'): minified/generated/too_large/unsupported.
  if (f.parser_mode === 'skipped') {
    const reason = (f.skip_reason || '').toLowerCase();
    if (reason.includes('minified') || kind === 'generated') {
      return row(f, kind, 'generated_excluded', `generated/minified artifact (${f.skip_reason || kind}) — excluded with proof, not parsed`, 'generated_classifier', 0.9);
    }
    if (reason.includes('too_large')) {
      return row(f, 'binary', 'resolved_metadata', 'oversized blob — classified by size/type, not parsed (would be noise)', 'size_classifier', 0.7);
    }
    // unsupported_ext: classify by kind so it's METADATA, not a black hole.
    if (kind === 'asset' || kind === 'binary') return row(f, kind, 'resolved_metadata', `${kind} file — classified, not source`, 'asset_classifier', 0.85);
    if (kind === 'docs') return row(f, kind, 'resolved_metadata', 'documentation — recorded as metadata', 'doc_classifier', 0.85);
    if (kind === 'config' || kind === 'schema' || kind === 'abi_runtime') return row(f, kind, 'resolved_metadata', `${kind} file — recorded; structured resolver can deepen this`, 'metadata_classifier', 0.75);
    // unsupported but source-like → needs a resolver, name it.
    if (kind === 'source' || kind === 'route' || kind === 'test') {
      return row(f, kind, 'resolver_missing', `source-like but unparsed: needs ${resolverRequirementFor(ext)}`, 'none', 0.3);
    }
    return row(f, kind, 'resolved_metadata', 'non-source file — classified', 'metadata_classifier', 0.6);
  }

  const hasResolver = HAS_RESOLVER.has(ext);
  const isSource = SOURCE_LIKE_KINDS.has(kind);
  // For resolver-backed languages, only relative/alias imports are gaps (bare =
  // external). For languages with NO resolver, every unresolved import is a gap.
  const localGaps = hasResolver ? f.unresolved_local : f.total_unresolved;

  // 3. Hard parse failure / no grammar produced nothing.
  if (f.hard_fail > 0 && f.symbol_count === 0) {
    if (isSource) return row(f, kind, 'resolver_missing', `no working parser/grammar: needs ${resolverRequirementFor(ext)}`, 'none', 0.25);
    return row(f, kind, 'failed_with_reason', 'parse failed and produced no symbols — recorded for follow-up', 'fallback', 0.2);
  }

  // 4. Parsed (tree-sitter or fallback), OR yielded imports (the grammar read it
  // even if it has no top-level symbols — e.g. a PHP bootstrap with only requires).
  if (f.symbol_count > 0 || f.total_imports > 0 || f.parser_mode === 'tree-sitter' || f.parser_mode === 'fallback') {
    // Dynamic/runtime references static analysis cannot pin down → needs runtime.
    if (f.dynamic_count > 0) {
      return row(f, kind, 'requires_runtime', `${f.dynamic_count} dynamic/runtime reference(s)${localGaps > 0 ? ` + ${localGaps} unresolved import(s)` : ''} — needs runtime/LSP/ABI to fully resolve`, f.parser_mode, 0.6);
    }
    // Source-like in a language with NO import resolver, and it has imports we can't
    // resolve: name the missing resolver — don't bury it as "partial".
    if (isSource && !hasResolver && f.total_imports > 0 && f.total_unresolved > 0) {
      return row(f, kind, 'resolver_missing', `${f.total_unresolved} import(s) and no resolver for this language: needs ${resolverRequirementFor(ext)}`, 'none', 0.45);
    }
    const partial = f.parser_mode === 'fallback' || f.parse_quality < 0.85 || localGaps > 0 || f.parse_error > 0;
    if (partial) {
      const why: string[] = [];
      if (f.parser_mode === 'fallback') why.push('fallback parser');
      if (localGaps > 0) why.push(`${localGaps} unresolved local import(s)`);
      if (f.parse_error > 0) why.push('parse warnings');
      if (f.parse_quality < 0.85) why.push(`quality ${f.parse_quality.toFixed(2)}`);
      return row(f, kind, 'resolved_partial', `parsed with caveats: ${why.join(', ') || 'reduced confidence'}`, f.parser_mode, Math.max(0.5, f.parse_quality));
    }
    return row(f, kind, 'resolved_full', 'parsed, symbols + imports resolved', f.parser_mode, Math.max(0.85, f.parse_quality));
  }

  // 5. Could not parse at all (no symbols, no imports). A source file we cannot
  // read deeply needs a native GRAMMAR (distinct from an import resolver) — name it.
  if (isSource) return row(f, kind, 'resolver_missing', `fallback produced no symbols: needs ${grammarRequirementFor(ext)}`, 'none', 0.2);
  return row(f, kind, 'resolved_metadata', 'no extractable symbols (empty/comment-only) — recorded', f.parser_mode, 0.7);
}

function row(f: FileFacts, kind: FileKind, state: ResolutionState, reason: string, resolver: string, confidence: number): ResolutionRow {
  return { file_id: f.file_id, kind, state, reason, resolver_used: resolver, confidence: Number(confidence.toFixed(2)) };
}

/** Recompute the resolution ledger for every file. Run after import resolution. */
export function classifyResolution(db: Database.Database, repoPath: string) {
  const facts = db.prepare(`
    SELECT
      f.id AS file_id, f.path AS path, f.lang AS lang,
      f.parser_mode AS parser_mode, COALESCE(f.parse_quality, 0) AS parse_quality,
      (SELECT COUNT(*) FROM symbols s WHERE s.file_id = f.id) AS symbol_count,
      -- LOCAL unresolved imports (gaps for resolver-backed langs): relative (any
      -- leading dot — JS './' and Python '.rel' alike) or alias ('@/', '#').
      (SELECT COUNT(*) FROM imports i WHERE i.from_file_id = f.id AND i.to_file_id IS NULL
         AND (i.specifier LIKE '.%' OR i.specifier LIKE '@/%' OR i.specifier LIKE '#%')) AS unresolved_local,
      (SELECT COUNT(*) FROM imports i WHERE i.from_file_id = f.id) AS total_imports,
      (SELECT COUNT(*) FROM imports i WHERE i.from_file_id = f.id AND i.to_file_id IS NULL) AS total_unresolved,
      (SELECT COUNT(*) FROM blindspots b WHERE b.file_id = f.id AND b.reason LIKE 'DYNAMIC%') AS dynamic_count,
      (SELECT COUNT(*) FROM blindspots b WHERE b.file_id = f.id AND (b.reason LIKE 'PARSE_ERROR%' OR b.reason LIKE 'DEGRADED_PARSE%')) AS parse_error,
      (SELECT COUNT(*) FROM blindspots b WHERE b.file_id = f.id AND (b.reason LIKE 'PARSE_FAILURE%' OR b.reason LIKE 'UNSUPPORTED_EXTENSION%')) AS hard_fail,
      (SELECT b.reason FROM blindspots b WHERE b.file_id = f.id AND b.reason LIKE 'skipped:%' LIMIT 1) AS skip_reason
    FROM files f
  `).all() as Array<Omit<FileFacts, 'path'> & { path: string }>;

  const upsert = db.prepare(`
    INSERT INTO resolution (file_id, kind, state, reason, resolver_used, confidence)
    VALUES (@file_id, @kind, @state, @reason, @resolver_used, @confidence)
    ON CONFLICT(file_id) DO UPDATE SET
      kind = excluded.kind, state = excluded.state, reason = excluded.reason,
      resolver_used = excluded.resolver_used, confidence = excluded.confidence
  `);

  const tx = db.transaction(() => {
    for (const fact of facts) {
      const rel = path.isAbsolute(fact.path) ? path.relative(repoPath, fact.path) : fact.path;
      upsert.run(deriveResolution({ ...fact, path: rel }));
    }
  });
  tx();
}

export interface ResolutionCoverage {
  total: number;
  byState: Record<string, number>;
  byKind: Record<string, number>;
  sourceFiles: number;
  sourceResolved: number;             // full + partial among source-like
  sourceResolutionCoverage: number;   // 0..1
  unresolvedSource: number;           // resolver_missing among source-like
  runtimeRequired: number;
  artifactsClassified: number;        // non-source with a state
  blockingRepairGaps: number;         // states that block destructive repair
  unknown: number;                    // the number that must always be 0
}

const SOURCE_LIKE: FileKind[] = ['source', 'route', 'test'];
const BLOCKING_STATES: ResolutionState[] = ['resolver_missing', 'requires_runtime', 'failed_with_reason'];

export function getResolutionCoverage(db: Database.Database): ResolutionCoverage {
  const rows = db.prepare(`SELECT r.kind, r.state FROM resolution r`).all() as Array<{ kind: FileKind; state: ResolutionState }>;
  const byState: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let sourceFiles = 0, sourceResolved = 0, unresolvedSource = 0, runtimeRequired = 0, artifactsClassified = 0, blockingRepairGaps = 0, unknown = 0;
  for (const r of rows) {
    byState[r.state] = (byState[r.state] || 0) + 1;
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    const isSource = SOURCE_LIKE.includes(r.kind);
    if (isSource) {
      sourceFiles++;
      if (r.state === 'resolved_full' || r.state === 'resolved_partial') sourceResolved++;
      if (r.state === 'resolver_missing') unresolvedSource++;
    } else if (r.state !== 'unsafe_excluded') {
      artifactsClassified++;
    }
    if (r.state === 'requires_runtime') runtimeRequired++;
    if (BLOCKING_STATES.includes(r.state)) blockingRepairGaps++;
    if (r.kind === 'unknown' && r.state !== 'resolved_metadata' && r.state !== 'unsafe_excluded' && r.state !== 'generated_excluded') unknown++;
  }
  return {
    total: rows.length,
    byState, byKind,
    sourceFiles, sourceResolved,
    sourceResolutionCoverage: sourceFiles ? sourceResolved / sourceFiles : 1,
    unresolvedSource, runtimeRequired, artifactsClassified, blockingRepairGaps, unknown,
  };
}

/** Resolution state for one file path (used by repair gating). */
export function getResolutionForPath(db: Database.Database, repoPath: string, filePath: string):
  { state: ResolutionState; kind: FileKind; reason: string; confidence: number } | null {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath);
  const r = db.prepare(`
    SELECT r.state, r.kind, r.reason, r.confidence
    FROM resolution r JOIN files f ON f.id = r.file_id
    WHERE f.path = ?
  `).get(abs) as { state: ResolutionState; kind: FileKind; reason: string; confidence: number } | undefined;
  return r || null;
}
