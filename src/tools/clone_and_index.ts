import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { indexProject } from './index_project';

function isValidPublicGithubUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url);
}

function safeBranch(branch: string): boolean {
  return /^[A-Za-z0-9._\/-]{1,120}$/.test(branch) && !branch.includes('..') && !branch.startsWith('-');
}

function repoSlug(url: string): string {
  const m = url.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/);
  if (!m) throw new Error('Invalid GitHub URL');
  return `${m[1]}__${m[2]}`.replace(/[^A-Za-z0-9_.-]+/g, '_');
}

function removeSymlinks(dir: string): number {
  let removed = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        try { fs.rmSync(full, { force: true, recursive: true }); removed++; } catch {}
      } else if (entry.isDirectory()) {
        stack.push(full);
      }
    }
  }
  return removed;
}

function dirSize(dir: string, limit: number): number {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      try {
        const stat = fs.lstatSync(full);
        if (stat.isDirectory()) stack.push(full);
        else if (stat.isFile()) total += stat.size;
        if (total > limit) return total;
      } catch {}
    }
  }
  return total;
}

export async function cloneAndIndex(repoUrl: string, options: { branch?: string; fresh?: boolean; max_bytes?: number; timeout_ms?: number; max_files?: number } = {}) {
  if (!isValidPublicGithubUrl(repoUrl)) {
    throw new Error('Only public HTTPS GitHub repo URLs are allowed, e.g. https://github.com/owner/repo');
  }
  if (repoUrl.includes('@') || repoUrl.includes('x-oauth-basic')) {
    throw new Error('Credential-bearing clone URLs are rejected. Use public repos only in v0.1.');
  }
  const branch = options.branch;
  if (branch && !safeBranch(branch)) throw new Error('Unsafe branch name rejected.');

  const cloneRoot = path.join(os.homedir(), '.omnicode', 'clones');
  fs.mkdirSync(cloneRoot, { recursive: true });
  const cacheKey = crypto.createHash('sha256').update(`${repoUrl}#${branch || 'default'}`).digest('hex').slice(0, 10);
  const target = path.join(cloneRoot, `${repoSlug(repoUrl)}_${cacheKey}`);
  if (options.fresh && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });

  const timeout = options.timeout_ms ?? 120000;
  let cloned = false;
  if (!fs.existsSync(target)) {
    const cloneArgs = branch
      ? ['clone', '--depth', '1', '--single-branch', '--branch', branch, '--quiet', repoUrl, target]
      : ['clone', '--depth', '1', '--quiet', repoUrl, target];
    execFileSync('git', cloneArgs, {
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

  const index = await indexProject(target, undefined, { maxFiles: options.max_files, maxBytes });
  return { repoUrl, branch: branch || 'default', clonePath: target, cloned, symlinksRemoved, sizeBytes: size, index };
}
