"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitPathParts = splitPathParts;
exports.assertIndexableRoot = assertIndexableRoot;
exports.isPathSafe = isPathSafe;
exports.enforceAllowedRoot = enforceAllowedRoot;
exports.enforceSandbox = enforceSandbox;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Path arg keys used across the tool surface that must stay inside the repo.
const PATH_ARG_KEYS = ['file_path', 'target_path', 'dir', 'file', 'glob', 'output_path'];
/** Split an absolute path into its anchor (drive / UNC share / posix root) and the segments below it. */
function splitPathParts(absInput) {
    const abs = absInput.trim();
    // UNC: \\server\share\... or //server/share/...  (not the \\?\ extended prefix form's drive case)
    const uncMatch = abs.match(/^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)(.*)$/);
    if (uncMatch) {
        const [, server, share, rest] = uncMatch;
        const segments = rest.split(/[\\/]+/).filter(Boolean);
        return { kind: 'unc', anchor: `\\\\${server}\\${share}`, segments };
    }
    // Drive: C:\... or C:/...
    const driveMatch = abs.match(/^([A-Za-z]):[\\/]*(.*)$/);
    if (driveMatch) {
        const [, letter, rest] = driveMatch;
        const segments = rest.split(/[\\/]+/).filter(Boolean);
        return { kind: 'drive', anchor: `${letter.toUpperCase()}:\\`, segments };
    }
    // POSIX
    const segments = abs.split('/').filter(Boolean);
    return { kind: 'posix', anchor: '/', segments };
}
// First-level directories that are too broad to index even though they sit one
// level below an anchor (e.g. C:\Users, /home). Compared case-insensitively.
const BROAD_FIRST_SEGMENTS = new Set([
    'users', 'windows', 'program files', 'program files (x86)', 'programdata',
    'home', 'usr', 'etc', 'var', 'opt', 'bin', 'lib', 'tmp', 'mnt', 'media',
    'system', 'library', 'applications', 'volumes',
].map((s) => s.toLowerCase()));
/**
 * Throw if `repoPath` is too broad to index safely. Allows normal project roots
 * (C:\repo, /home/me/app, \\server\share\repo) and rejects drive/share/system roots.
 */
function assertIndexableRoot(repoPath) {
    // Lexical resolve only — NEVER realpath here. The broad-root check is purely
    // structural, and realpath on a UNC path triggers a multi-second network probe.
    const abs = path_1.default.resolve(repoPath);
    const { kind, anchor, segments } = splitPathParts(abs);
    // Bare anchor: drive root (C:\), UNC share root (\\server\share), or posix root (/).
    if (segments.length === 0) {
        const what = kind === 'unc' ? `UNC share root '${anchor}'`
            : kind === 'drive' ? `drive root '${anchor}'`
                : `filesystem root '/'`;
        throw new Error(`Refusing to index ${what}: too broad to index safely. Point at a specific project directory.`);
    }
    // One level below a drive/posix anchor, into a known system/home location.
    // UNC share-children are exempt — a share is already a scoped namespace, which
    // is exactly the case the v1.108.27 fix restored.
    if (kind !== 'unc' && segments.length === 1 && BROAD_FIRST_SEGMENTS.has(segments[0].toLowerCase())) {
        throw new Error(`Refusing to index '${abs}': '${segments[0]}' is a broad system directory. Point at a specific project inside it.`);
    }
}
/** Resolve symlinks where the path exists so a symlink can't point outside the repo. */
function realResolve(p) {
    const abs = path_1.default.resolve(p);
    try {
        return fs_1.default.realpathSync(abs);
    }
    catch {
        // Path may not exist yet (e.g. an output path) — fall back to the lexical resolve.
        return abs;
    }
}
function isPathSafe(repoPath, targetPath) {
    const absoluteRepo = realResolve(repoPath);
    // Resolve the target RELATIVE to the repo, then realpath it.
    const absoluteTarget = realResolve(path_1.default.resolve(repoPath, targetPath));
    if (absoluteTarget === absoluteRepo)
        return true;
    // Trailing separator prevents sibling-prefix attacks (/repo vs /repo-evil).
    return absoluteTarget.startsWith(absoluteRepo + path_1.default.sep);
}
/** Server-configured allowlist of roots the MCP may operate under (optional). */
function allowedRoots() {
    const raw = process.env.OMNICODE_ALLOWED_ROOTS;
    if (!raw)
        return [];
    return raw
        .split(path_1.default.delimiter)
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => realResolve(r));
}
/** If an allowlist is configured, the repo root itself must live within it. */
function enforceAllowedRoot(repoPath) {
    const roots = allowedRoots();
    if (roots.length === 0)
        return; // not configured -> operator opted out of root-pinning
    const absRepo = realResolve(repoPath);
    const ok = roots.some((root) => absRepo === root || absRepo.startsWith(root + path_1.default.sep));
    if (!ok) {
        throw new Error(`Sandbox violation: repository root '${repoPath}' is not within any OMNICODE_ALLOWED_ROOTS entry.`);
    }
}
function enforceSandbox(repoPath, args) {
    enforceAllowedRoot(repoPath);
    for (const key of PATH_ARG_KEYS) {
        const val = args[key];
        if (typeof val === 'string' && val.length > 0) {
            if (!isPathSafe(repoPath, val)) {
                throw new Error(`Sandbox violation: Access to path '${val}' is outside the authorized repository context.`);
            }
        }
    }
}
