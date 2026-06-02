import fs from 'fs';
import path from 'path';

export interface ScannedFile {
  path: string;
  lang: string;
  size: number;
}

export interface ScanOptions {
  maxFiles?: number;
  maxBytes?: number;
  maxScanMs?: number;
  maxFileBytes?: number;
  includeJson?: boolean;
  ignorePatterns?: string[];
}

export interface ScanStats {
  discoveredFiles: number;
  indexedCandidates: number;
  sourceBytes: number;
  skippedDirs: number;
  skippedFiles: number;
  generatedSkipped: number;
  oversizedSkipped: number;
  maxFilesHit: boolean;
  maxBytesHit: boolean;
  timeLimitHit: boolean;
  scanMs: number;
  stopReason: string | null;
  // Every directory the scan chose NOT to descend into, with why. No silent skips:
  // exclusions are reported so "everything accounted for" is literally true.
  excludedDirs: Array<{ dir: string; reason: string }>;
}

export interface SkippedFile {
  path: string;
  size: number;
  reason: 'minified' | 'generated' | 'too_large' | 'unsupported_ext';
}

export interface ScanResult {
  files: ScannedFile[];
  skipped: SkippedFile[];
  stats: ScanStats;
}

// Absolute ceiling: above this we never parse, even authored source, to protect
// the process. Such files are still RECORDED as skipped blindspots (not hidden).
const HARD_MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Decide whether an over-cap file is a minified/generated blob (skip the parse,
 * its symbols would be noise) or genuinely large authored source (still parse —
 * dropping it would leave a real hole in repo coverage). Content-based, not size.
 */
function isLikelyMinified(filePath: string): boolean {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(131072); // peek first 128KB
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    if (read === 0) return false;
    const text = buf.toString('utf8', 0, read);
    let newlines = 0, maxLine = 0, cur = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) { newlines++; if (cur > maxLine) maxLine = cur; cur = 0; }
      else cur++;
    }
    if (cur > maxLine) maxLine = cur;
    // Minified signature: almost no newlines, or extremely long average/peak lines.
    if (newlines === 0) return true;
    if (maxLine > 5000) return true;
    if (read / newlines > 2000) return true;
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

// NO CAPS: scans never STOP. The scanner walks the entire tree end-to-end so
// `discovered == represented` on every repo. maxFiles/maxBytes/maxScanMs are kept
// in ScanOptions for back-compat but are intentionally NOT enforced as stops —
// a tool that quits at file N leaves N+1..end invisible and forces raw reads,
// which defeats the entire token-saving premise. Per-file size classification
// (below) still applies: huge/minified blobs get a represented stub, never a parse.
// Per-file cap: files larger than this are almost always minified bundles or
// generated blobs. tree-sitter parses them pathologically slowly (a single 2MB
// bundle can stall an entire repo), and their symbols are noise. Skip them.
const DEFAULT_MAX_FILE_BYTES = Number(process.env.OMNICODE_MAX_FILE_BYTES || 512 * 1024);

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '_next', 'out', '.vscode',
  'coverage', '.turbo', '.cache', '.parcel-cache', '.svelte-kit', '.nuxt', '.output',
  'vendor', 'venv', '.venv', 'env', '.env', '__pycache__', '.pytest_cache', '.mypy_cache',
  'target', 'bin', 'obj', '.gradle', '.idea', 'Pods', 'DerivedData', 'generated', 'coverage',
  '$PLUGINSDIR', 'decompiled', 'extracted_full', 'app_extracted', 'release', 'releases'
]);

// Dot-directories that hold REAL project files (CI, editor, tooling config). These
// must NOT be blanket-skipped just for starting with a dot — that loses authored
// content. Everything else dot-prefixed (.git, .cache, our own .omnicode) is skipped.
const ALLOW_DOT_DIRS = new Set([
  '.github', '.gitlab', '.circleci', '.azure', '.azuredevops', '.vscode', '.config',
  '.husky', '.changeset', '.devcontainer', '.storybook', '.chromatic', '.yarn',
]);

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.cs', '.java', '.kt', '.php', '.rb', '.swift', '.c', '.h', '.cpp', '.hpp', '.sol', '.lua']);
const EXTRA_BENCHMARK_EXTENSIONS = new Set(['.json', '.md', '.yaml', '.yml']);

const GENERATED_PATH_PARTS = [
  `${path.sep}$PLUGINSDIR${path.sep}`,
  `${path.sep}decompiled${path.sep}`,
  `${path.sep}extracted_full${path.sep}`,
  `${path.sep}app_extracted${path.sep}`,
  `${path.sep}static${path.sep}chunks${path.sep}`,
  `${path.sep}static${path.sep}webpack${path.sep}`,
  `${path.sep}generated${path.sep}`,
  `${path.sep}coverage${path.sep}`,
];

function isGeneratedArtifactPath(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  return GENERATED_PATH_PARTS.some((part) => normalized.includes(part));
}

function normalizeForMatch(p: string): string {
  return path.normalize(p).replace(/\\/g, '/');
}

function simpleIgnoreMatch(filePath: string, repoPath: string, patterns: string[]): boolean {
  if (!patterns.length) return false;
  const rel = normalizeForMatch(path.relative(repoPath, filePath));
  const abs = normalizeForMatch(filePath);
  for (const raw of patterns) {
    const p = normalizeForMatch(String(raw).trim());
    if (!p) continue;
    const core = p
      .replace(/^\*\*\//, '')
      .replace(/\/\*\*$/, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '');
    if (!core) continue;
    if (rel === core || rel.startsWith(`${core}/`) || rel.includes(`/${core}/`)) return true;
    if (abs.includes(core)) return true;
  }
  return false;
}

function toLang(ext: string): string {
  return ext.startsWith('.') ? ext.substring(1) : ext;
}

export function isSupportedSourceFile(fileName: string, includeJson = false): boolean {
  const ext = path.extname(fileName);
  if (SUPPORTED_EXTENSIONS.has(ext)) return true;
  return includeJson && EXTRA_BENCHMARK_EXTENSIONS.has(ext);
}

export function scanRepositoryWithStats(repoPath: string, options: ScanOptions = {}): ScanResult {
  const started = Date.now();
  const maxFileBytes = Math.max(1024, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
  const includeJson = !!options.includeJson;
  const ignorePatterns = options.ignorePatterns || [];

  const files: ScannedFile[] = [];
  const skipped: SkippedFile[] = [];
  const stats: ScanStats = {
    discoveredFiles: 0,
    indexedCandidates: 0,
    sourceBytes: 0,
    skippedDirs: 0,
    skippedFiles: 0,
    generatedSkipped: 0,
    oversizedSkipped: 0,
    maxFilesHit: false,
    maxBytesHit: false,
    timeLimitHit: false,
    scanMs: 0,
    stopReason: null,
    excludedDirs: [],
  };
  const recordExcluded = (full: string, name: string, reason: string) =>
    stats.excludedDirs.push({ dir: path.relative(repoPath, full) || name, reason });

  if (!fs.existsSync(repoPath)) {
    stats.stopReason = 'repo_path_missing';
    return { files, skipped, stats };
  }

  const stack = [repoPath];
  while (stack.length > 0) {
    // NO CAPS: no time/file-count/byte stop. The walk always completes.
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      stats.skippedDirs++;
      continue;
    }

    // Stable order makes benchmark runs repeatable and puts source-looking folders first.
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      // Skip ignore dirs (deps/build/vcs caches) and dot-DIRECTORIES — but NOT the
      // ones that hold real project config (.github, .vscode, …). Every skip is
      // RECORDED, never silent. Dot-FILES (.env, .npmrc) always flow through.
      if (entry.isDirectory()) {
        const ignored = IGNORE_DIRS.has(entry.name);
        const blockedDot = entry.name.startsWith('.') && !ALLOW_DOT_DIRS.has(entry.name);
        if (ignored || blockedDot) {
          stats.skippedDirs++;
          recordExcluded(fullPath, entry.name, ignored ? 'dependency/build/vcs cache' : 'dot-directory');
          continue;
        }
      }
      if (simpleIgnoreMatch(fullPath, repoPath, ignorePatterns)) {
        if (entry.isDirectory()) { stats.skippedDirs++; recordExcluded(fullPath, entry.name, 'ignore-pattern'); }
        else stats.skippedFiles++;
        continue;
      }
      if (isGeneratedArtifactPath(fullPath)) {
        if (entry.isDirectory()) { stats.skippedDirs++; recordExcluded(fullPath, entry.name, 'generated-path'); }
        else stats.generatedSkipped++;
        continue;
      }
      if (entry.isSymbolicLink()) {
        stats.skippedFiles++;
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        stats.skippedFiles++;
        continue;
      }
      stats.discoveredFiles++;
      if (!isSupportedSourceFile(entry.name, includeJson)) {
        // Unsupported extension: don't drop it silently (that's an invisible
        // token leak). Record it so the indexer represents it as a Tier-4 stub
        // row — the agent can still reach it without a raw read.
        try {
          const st = fs.statSync(fullPath);
          if (st.size > 0) skipped.push({ path: fullPath, size: st.size, reason: 'unsupported_ext' });
        } catch { stats.skippedFiles++; }
        continue;
      }

      try {
        const stat = fs.statSync(fullPath);
        if (stat.size <= 0) continue;
        // Over the per-file cap: classify rather than blindly drop, so we never
        // lose authored source and every skip is a visible, typed blindspot.
        if (stat.size > maxFileBytes) {
          if (stat.size > HARD_MAX_FILE_BYTES) {
            stats.oversizedSkipped++;
            skipped.push({ path: fullPath, size: stat.size, reason: 'too_large' });
            continue;
          }
          if (isLikelyMinified(fullPath)) {
            stats.oversizedSkipped++;
            skipped.push({ path: fullPath, size: stat.size, reason: 'minified' });
            continue;
          }
          // Large but authored — index it. Coverage over speed.
        }
        const ext = path.extname(entry.name);
        files.push({ path: fullPath, lang: toLang(ext), size: stat.size });
        stats.indexedCandidates++;
        stats.sourceBytes += stat.size;
      } catch {
        stats.skippedFiles++;
      }
    }
  }

  stats.scanMs = Date.now() - started;
  return { files, skipped, stats };
}

export function scanRepository(repoPath: string, options: ScanOptions = {}): ScannedFile[] {
  return scanRepositoryWithStats(repoPath, options).files;
}

export function estimateRawSourceStats(repoPath: string, options: ScanOptions = {}) {
  const { files, stats } = scanRepositoryWithStats(repoPath, { ...options, includeJson: true });
  return {
    files: files.length,
    bytes: stats.sourceBytes,
    tokens: Math.ceil(stats.sourceBytes / 4),
    stats,
  };
}
