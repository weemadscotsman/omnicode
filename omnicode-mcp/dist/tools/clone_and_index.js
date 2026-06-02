"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloneAndIndex = cloneAndIndex;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const index_project_1 = require("./index_project");
function isValidPublicGithubUrl(url) {
    return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url);
}
function safeBranch(branch) {
    return /^[A-Za-z0-9._\/-]{1,120}$/.test(branch) && !branch.includes('..') && !branch.startsWith('-');
}
function repoSlug(url) {
    const m = url.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
    if (!m)
        throw new Error('Invalid GitHub URL');
    return `${m[1]}__${m[2]}`.replace(/[^A-Za-z0-9_.-]+/g, '_');
}
function removeSymlinks(dir) {
    let removed = 0;
    const stack = [dir];
    while (stack.length) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = fs_1.default.readdirSync(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const full = path_1.default.join(current, entry.name);
            if (entry.isSymbolicLink()) {
                try {
                    fs_1.default.rmSync(full, { force: true, recursive: true });
                    removed++;
                }
                catch { }
            }
            else if (entry.isDirectory()) {
                stack.push(full);
            }
        }
    }
    return removed;
}
function dirSize(dir, limit) {
    let total = 0;
    const stack = [dir];
    while (stack.length) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = fs_1.default.readdirSync(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const full = path_1.default.join(current, entry.name);
            try {
                const stat = fs_1.default.lstatSync(full);
                if (stat.isDirectory())
                    stack.push(full);
                else if (stat.isFile())
                    total += stat.size;
                if (total > limit)
                    return total;
            }
            catch { }
        }
    }
    return total;
}
async function cloneAndIndex(repoUrl, options = {}) {
    if (!isValidPublicGithubUrl(repoUrl)) {
        throw new Error('Only public HTTPS GitHub repo URLs are allowed, e.g. https://github.com/owner/repo');
    }
    if (repoUrl.includes('@') || repoUrl.includes('x-oauth-basic')) {
        throw new Error('Credential-bearing clone URLs are rejected. Use public repos only in v0.1.');
    }
    const branch = options.branch;
    if (branch && !safeBranch(branch))
        throw new Error('Unsafe branch name rejected.');
    const cloneRoot = path_1.default.join(os_1.default.homedir(), '.omnicode', 'clones');
    fs_1.default.mkdirSync(cloneRoot, { recursive: true });
    const cacheKey = crypto_1.default.createHash('sha256').update(`${repoUrl}#${branch || 'default'}`).digest('hex').slice(0, 10);
    const target = path_1.default.join(cloneRoot, `${repoSlug(repoUrl)}_${cacheKey}`);
    if (options.fresh && fs_1.default.existsSync(target))
        fs_1.default.rmSync(target, { recursive: true, force: true });
    const timeout = options.timeout_ms ?? 120000;
    let cloned = false;
    if (!fs_1.default.existsSync(target)) {
        const cloneArgs = branch
            ? ['clone', '--depth', '1', '--single-branch', '--branch', branch, '--quiet', repoUrl, target]
            : ['clone', '--depth', '1', '--quiet', repoUrl, target];
        (0, child_process_1.execFileSync)('git', cloneArgs, {
            timeout,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        cloned = true;
    }
    const symlinksRemoved = removeSymlinks(target);
    const maxBytes = options.max_bytes ?? 250 * 1024 * 1024;
    const size = dirSize(target, maxBytes);
    if (size > maxBytes) {
        throw new Error(`Cloned repository exceeds max_bytes guard (${size} > ${maxBytes}).`);
    }
    const index = await (0, index_project_1.indexProject)(target, undefined, { maxFiles: options.max_files, maxBytes });
    return { repoUrl, branch: branch || 'default', clonePath: target, cloned, symlinksRemoved, sizeBytes: size, index };
}
