import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { signSession, resolveApiKey, getIdentity } from '../lib/auth';
import { Role } from '../lib/rbac';
import { NextRequest } from 'next/server';

const SECRET = crypto.randomBytes(32).toString('hex');
const RAW_KEY = 'omni_test_' + crypto.randomBytes(16).toString('hex');
const KEY_HASH = crypto.createHash('sha256').update(RAW_KEY).digest('hex');

beforeEach(() => {
  process.env.OMNICODE_SESSION_SECRET = SECRET;
  process.env.OMNICODE_API_KEYS = JSON.stringify([
    { keyHash: KEY_HASH, user: 'alice', role: Role.Admin },
  ]);
});

describe('signSession / getIdentity via cookie', () => {
  it('issues a token that resolves back to the same identity', () => {
    const token = signSession('alice', Role.Admin);
    expect(token).toBeTruthy();

    const req = new NextRequest('http://localhost/api', {
      headers: { cookie: `omnicode_session=${token}` },
    });
    const id = getIdentity(req);
    expect(id).not.toBeNull();
    expect(id!.user).toBe('alice');
    expect(id!.role).toBe(Role.Admin);
    expect(id!.via).toBe('session');
  });

  it('rejects a tampered token', () => {
    const token = signSession('alice', Role.Admin)!;
    const tampered = token.slice(0, -4) + 'XXXX';
    const req = new NextRequest('http://localhost/api', {
      headers: { cookie: `omnicode_session=${tampered}` },
    });
    expect(getIdentity(req)).toBeNull();
  });

  it('returns null when no credentials provided', () => {
    const req = new NextRequest('http://localhost/api');
    expect(getIdentity(req)).toBeNull();
  });

  it('returns null when secret is missing', () => {
    delete process.env.OMNICODE_SESSION_SECRET;
    const req = new NextRequest('http://localhost/api', {
      headers: { cookie: 'omnicode_session=anything' },
    });
    expect(getIdentity(req)).toBeNull();
  });
});

describe('resolveApiKey', () => {
  it('resolves a valid key to the correct identity', () => {
    const id = resolveApiKey(RAW_KEY);
    expect(id).not.toBeNull();
    expect(id!.user).toBe('alice');
    expect(id!.role).toBe(Role.Admin);
    expect(id!.via).toBe('apikey');
  });

  it('returns null for an invalid key', () => {
    expect(resolveApiKey('bad_key')).toBeNull();
  });

  it('returns null when API_KEYS env is unset', () => {
    delete process.env.OMNICODE_API_KEYS;
    expect(resolveApiKey(RAW_KEY)).toBeNull();
  });
});

describe('getIdentity via Bearer token', () => {
  it('resolves a valid Bearer API key', () => {
    const req = new NextRequest('http://localhost/api', {
      headers: { authorization: `Bearer ${RAW_KEY}` },
    });
    const id = getIdentity(req);
    expect(id).not.toBeNull();
    expect(id!.user).toBe('alice');
  });

  it('returns null for an invalid Bearer key', () => {
    const req = new NextRequest('http://localhost/api', {
      headers: { authorization: 'Bearer notakey' },
    });
    expect(getIdentity(req)).toBeNull();
  });
});
