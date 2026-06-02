import { NextRequest, NextResponse } from 'next/server';
import { resolveApiKey, signSession, SESSION_COOKIE } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

// Exchange a valid API key for a short-lived, HMAC-signed session cookie.
// This lets the dashboard authenticate — including EventSource (SSE), which
// cannot set Authorization headers but does send same-origin cookies.
export async function POST(req: NextRequest) {
  let apiKey = '';
  try {
    ({ apiKey } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const id = resolveApiKey(String(apiKey || ''));
  if (!id) {
    await logAudit({ user: 'anonymous', role: 'unknown', action: 'auth:login', details: 'Invalid API key', outcome: 'failure' });
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }

  const token = signSession(id.user, id.role);
  if (!token) {
    return NextResponse.json(
      { error: 'Server auth not configured (set OMNICODE_SESSION_SECRET).' },
      { status: 500 }
    );
  }

  await logAudit({ user: id.user, role: id.role, action: 'auth:login', details: 'Session established', outcome: 'success' });

  const res = NextResponse.json({ user: id.user, role: id.role });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
