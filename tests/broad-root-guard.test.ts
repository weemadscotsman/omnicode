import { describe, it, expect } from 'vitest';
import { splitPathParts, assertIndexableRoot } from '../omnicode-mcp/src/security/sandbox';

// NOTE: assertIndexableRoot calls realResolve (path.resolve + realpathSync fallback).
// For non-existent test paths the realpath throws and it falls back to the lexical
// absolute path, so these assertions exercise the guard logic directly.

describe('splitPathParts', () => {
  it('splits a UNC path counting server+share as the anchor', () => {
    const p = splitPathParts('\\\\server\\share\\repo\\src');
    expect(p.kind).toBe('unc');
    expect(p.anchor).toBe('\\\\server\\share');
    expect(p.segments).toEqual(['repo', 'src']);
  });

  it('treats a bare UNC share as anchor with no segments', () => {
    const p = splitPathParts('\\\\server\\share');
    expect(p.kind).toBe('unc');
    expect(p.segments).toEqual([]);
  });

  it('splits a drive path', () => {
    const p = splitPathParts('C:\\Users\\me\\repo');
    expect(p.kind).toBe('drive');
    expect(p.anchor).toBe('C:\\');
    expect(p.segments).toEqual(['Users', 'me', 'repo']);
  });

  it('treats a bare drive root as anchor with no segments', () => {
    expect(splitPathParts('C:\\').segments).toEqual([]);
  });

  it('splits a posix path', () => {
    const p = splitPathParts('/home/me/repo');
    expect(p.kind).toBe('posix');
    expect(p.segments).toEqual(['home', 'me', 'repo']);
  });
});

describe('assertIndexableRoot — rejects broad roots', () => {
  it('rejects a bare UNC share root', () => {
    expect(() => assertIndexableRoot('\\\\server\\share')).toThrow(/too broad/i);
  });

  it('rejects a drive root', () => {
    expect(() => assertIndexableRoot('C:\\')).toThrow(/too broad/i);
  });

  it('rejects C:\\Users (system/home dir)', () => {
    expect(() => assertIndexableRoot('C:\\Users')).toThrow(/broad system directory/i);
  });

  it('rejects C:\\Windows', () => {
    expect(() => assertIndexableRoot('C:\\Windows')).toThrow(/broad system directory/i);
  });

  it('rejects /home', () => {
    expect(() => assertIndexableRoot('/home')).toThrow(/broad system directory/i);
  });

  it('rejects the posix filesystem root', () => {
    expect(() => assertIndexableRoot('/')).toThrow(/too broad/i);
  });
});

describe('assertIndexableRoot — allows real project roots', () => {
  it('allows a UNC share child (the v1.108.27 fix)', () => {
    expect(() => assertIndexableRoot('\\\\server\\share\\repo')).not.toThrow();
  });

  it('allows a deeper UNC project path', () => {
    expect(() => assertIndexableRoot('\\\\server\\share\\team\\project')).not.toThrow();
  });

  it('allows a project directly under a drive (C:\\repo)', () => {
    expect(() => assertIndexableRoot('C:\\repo')).not.toThrow();
  });

  it('allows a normal nested project under a user home', () => {
    expect(() => assertIndexableRoot('C:\\Users\\me\\projects\\app')).not.toThrow();
  });

  it('allows a posix project path', () => {
    expect(() => assertIndexableRoot('/home/me/code/app')).not.toThrow();
  });
});
