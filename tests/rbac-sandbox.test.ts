import { describe, it, expect } from 'vitest';
import path from 'path';
import { hasPermission, Permission, Role } from '../lib/rbac';
import { isPathSafe } from '../omnicode-mcp/src/security/sandbox';
import { checkPermission } from '../omnicode-mcp/src/security/rbac';

// ── Web dashboard RBAC ────────────────────────────────────────────────────

describe('dashboard hasPermission', () => {
  it('Admin can index and search', () => {
    expect(hasPermission(Role.Admin, Permission.IndexCode)).toBe(true);
    expect(hasPermission(Role.Admin, Permission.SearchSymbols)).toBe(true);
  });

  it('Developer can index and search', () => {
    expect(hasPermission(Role.Developer, Permission.IndexCode)).toBe(true);
    expect(hasPermission(Role.Developer, Permission.SearchSymbols)).toBe(true);
  });

  it('Read-Only cannot index', () => {
    expect(hasPermission(Role.ReadOnly, Permission.IndexCode)).toBe(false);
  });

  it('Read-Only can search', () => {
    expect(hasPermission(Role.ReadOnly, Permission.SearchSymbols)).toBe(true);
  });

  it('unknown role is denied', () => {
    expect(hasPermission('hacker' as Role, Permission.IndexCode)).toBe(false);
  });
});

// ── MCP server RBAC ──────────────────────────────────────────────────────

describe('mcp checkPermission', () => {
  it('admin can access every tool', () => {
    expect(checkPermission('admin', 'index_project')).toBe(true);
    expect(checkPermission('admin', 'search_symbols')).toBe(true);
    expect(checkPermission('admin', 'spaghetti_report')).toBe(true);
  });

  it('agent can index and search', () => {
    expect(checkPermission('agent', 'index_project')).toBe(true);
    expect(checkPermission('agent', 'search_symbols')).toBe(true);
  });

  it('read-only cannot index', () => {
    expect(checkPermission('read-only', 'index_project')).toBe(false);
  });

  it('read-only can search', () => {
    expect(checkPermission('read-only', 'search_symbols')).toBe(true);
  });

  it('unknown role is denied', () => {
    expect(checkPermission('ghost' as any, 'search_symbols')).toBe(false);
  });
});

// ── Sandbox path enforcement ─────────────────────────────────────────────

describe('isPathSafe', () => {
  const repo = path.resolve('C:/projects/myrepo');

  it('allows a path inside the repo', () => {
    expect(isPathSafe(repo, 'C:/projects/myrepo/src/index.ts')).toBe(true);
  });

  it('allows the repo root itself', () => {
    expect(isPathSafe(repo, repo)).toBe(true);
  });

  it('blocks a sibling directory (prefix attack)', () => {
    expect(isPathSafe(repo, 'C:/projects/myrepo-evil/secret.ts')).toBe(false);
  });

  it('blocks path traversal above repo', () => {
    expect(isPathSafe(repo, 'C:/projects/myrepo/../../etc/passwd')).toBe(false);
  });

  it('blocks an absolute path outside repo', () => {
    expect(isPathSafe(repo, 'C:/Windows/System32/drivers/etc/hosts')).toBe(false);
  });
});
