import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { Role } from './rbac';

// ───────────────────────────────────────────────────────────────────────────
// Real authentication for OmniCode.
//
// The previous model read `x-role` / `x-user` straight from request headers, so
// ANY caller could set `x-role: Admin` and bypass all RBAC. This module replaces
// that with server-side identity resolution:
//
//   1. Authorization: Bearer <api-key>  — the key is hashed and looked up in a
//      server-side store (OMNICODE_API_KEYS). The ROLE comes from the store, not
//      from the client.
//   2. A short-lived HMAC-signed session cookie (set by /api/auth/login) so the
//      dashboard — including EventSource, which cannot set headers — can carry an
//      identity that is impossible to forge without OMNICODE_SESSION_SECRET.
//
// No valid credential => no identity => request is denied.
// ───────────────────────────────────────────────────────────────────────────

export interface Identity {
  user: string;
  role: Role;
  via: 'apikey' | 'session';
}

interface KeyRecord {
  keyHash: string; // sha256(rawKey) hex — raw keys are never stored
  user: string;
  role: Role;
}

export const SESSION_COOKIE = 'omnicode_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function isRole(v: unknown): v is Role {
  return v === Role.Admin || v === Role.Developer || v === Role.ReadOnly;
}

function loadKeyStore(): KeyRecord[] {
  const raw = process.env.OMNICODE_API_KEYS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is KeyRecord =>
        r && typeof r.keyHash === 'string' && typeof r.user === 'string' && isRole(r.role)
    );
  } catch {
    return [];
  }
}

function sessionSecret(): string | null {
  const s = process.env.OMNICODE_SESSION_SECRET;
  return s && s.length >= 16 ? s : null;
}

/** Resolve a raw API key to an identity, or null. Constant-time per record. */
export function resolveApiKey(rawKey: string): Identity | null {
  if (!rawKey) return null;
  const hash = sha256Hex(rawKey);
  let found: Identity | null = null;
  // Iterate the whole store (don't early-return) to avoid leaking which key matched via timing.
  for (const rec of loadKeyStore()) {
    if (timingSafeEqualStr(hash, rec.keyHash)) {
      found = { user: rec.user, role: rec.role, via: 'apikey' };
    }
  }
  return found;
}

/** Create a signed session token for a validated identity. Null if no secret configured. */
export function signSession(user: string, role: Role): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const payload = JSON.stringify({ u: user, r: role, exp: Date.now() + SESSION_TTL_MS });
  const body = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token: string): Identity | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!timingSafeEqualStr(sig, expected)) return null;
  try {
    const { u, r, exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof u !== 'string' || !isRole(r) || typeof exp !== 'number') return null;
    if (Date.now() > exp) return null;
    return { user: u, role: r, via: 'session' };
  } catch {
    return null;
  }
}

/** Resolve the caller's identity from the request, or null if unauthenticated. */
export function getIdentity(req: NextRequest): Identity | null {
  const authz = req.headers.get('authorization');
  if (authz && authz.toLowerCase().startsWith('bearer ')) {
    const id = resolveApiKey(authz.slice(7).trim());
    if (id) return id;
  }
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie) {
    const id = verifySession(cookie);
    if (id) return id;
  }
  return null;
}

/** Helper for scripts/admins: turn a raw key into the hash to store in OMNICODE_API_KEYS. */
export function hashApiKey(rawKey: string): string {
  return sha256Hex(rawKey);
}
