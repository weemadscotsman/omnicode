import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { redactSecrets } from './redact';

// ───────────────────────────────────────────────────────────────────────────
// Tamper-evident SIEM audit log.
//
// Every entry is hash-chained: hash = sha256(prevHash + canonicalEntry). Altering
// or deleting any past entry breaks the chain for all following entries, which
// verifyAuditChain() detects. Identities are recorded from the server-resolved
// session/key (see lib/auth.ts), never from client-supplied headers, so the log
// has trustworthy attribution. Secrets are redacted before they are written.
// ───────────────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  timestamp: string;
  user: string;
  role: string;
  action: string;
  details: string;
  outcome: 'success' | 'failure';
  prevHash: string;
  hash: string;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const LOG_FILE = path.join(DATA_DIR, 'audit_logs.jsonl');
const GENESIS = '0'.repeat(64);
const TAIL_BYTES = 256 * 1024; // cap how much of the log we read for listing/last-hash

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Read at most the last `maxBytes` of a file as text (true tail — avoids OOM on huge logs). */
async function readTail(file: string, maxBytes: number): Promise<string> {
  let fh;
  try {
    fh = await fs.open(file, 'r');
    const { size } = await fh.stat();
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return '';
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    let text = buf.toString('utf8');
    // If we started mid-file, drop the first (likely partial) line.
    if (start > 0) {
      const nl = text.indexOf('\n');
      if (nl >= 0) text = text.slice(nl + 1);
    }
    return text;
  } catch {
    return '';
  } finally {
    await fh?.close();
  }
}

async function getLastHash(): Promise<string> {
  const tail = await readTail(LOG_FILE, TAIL_BYTES);
  const lines = tail.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (typeof e.hash === 'string') return e.hash;
    } catch {
      /* skip malformed */
    }
  }
  return GENESIS;
}

let writeChain: Promise<void> = Promise.resolve();

export async function logAudit(
  entry: Omit<AuditLogEntry, 'timestamp' | 'prevHash' | 'hash'>
): Promise<void> {
  // Serialize writes so the hash chain stays consistent under concurrency.
  const run = writeChain.then(async () => {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const prevHash = await getLastHash();
      const core = {
        timestamp: new Date().toISOString(),
        user: entry.user || 'anonymous',
        role: entry.role || 'unknown',
        action: entry.action,
        details: redactSecrets(entry.details),
        outcome: entry.outcome,
        prevHash,
      };
      const hash = sha256Hex(prevHash + JSON.stringify(core));
      const line: AuditLogEntry = { ...core, hash };
      await fs.appendFile(LOG_FILE, JSON.stringify(line) + '\n');
      console.log(`[AUDIT] ${line.outcome.toUpperCase()}: ${line.action} by ${line.user} (${line.role})`);
    } catch (err) {
      console.error('Failed to write audit log', err);
    }
  });
  writeChain = run.catch(() => {});
  return run;
}

/** Most recent `limit` entries (newest first), read from the tail only. */
export async function getAuditLogs(limit = 200): Promise<AuditLogEntry[]> {
  const tail = await readTail(LOG_FILE, TAIL_BYTES);
  const lines = tail.trim().split('\n').filter(Boolean);
  const out: AuditLogEntry[] = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch {
      /* skip */
    }
  }
  return out.reverse().slice(0, limit);
}

/**
 * Verify the full hash chain. Reads the whole file (integrity checks are rare and
 * deliberate). Returns the first broken line if tampering is detected.
 */
export async function verifyAuditChain(): Promise<{ ok: boolean; entries: number; brokenAtLine?: number }> {
  let raw = '';
  try {
    raw = await fs.readFile(LOG_FILE, 'utf-8');
  } catch {
    return { ok: true, entries: 0 };
  }
  const lines = raw.trim().split('\n').filter(Boolean);
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i++) {
    let e: AuditLogEntry;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      return { ok: false, entries: i, brokenAtLine: i + 1 };
    }
    if (e.prevHash !== prev) return { ok: false, entries: i, brokenAtLine: i + 1 };
    const { hash, ...core } = e;
    const expected = sha256Hex(prev + JSON.stringify(core));
    if (hash !== expected) return { ok: false, entries: i, brokenAtLine: i + 1 };
    prev = hash;
  }
  return { ok: true, entries: lines.length };
}
