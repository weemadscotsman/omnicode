import { initDb } from '../store/db';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { redactSecrets } from './redact';

export interface AuditFields {
  argsHash?: string;
  caller?: string;
  repo?: string;
}

export function logAudit(
  repoPath: string | undefined,
  user: string,
  role: string,
  tool: string,
  outcome: string,
  detail: string,
  extra: AuditFields = {}
) {
  const safeDetail = redactSecrets(detail);
  const argsHash = extra.argsHash || null;
  const caller = extra.caller || null;
  const repo = extra.repo || repoPath || null;

  try {
    if (repoPath) {
      const db = initDb(repoPath);
      const insertAudit = db.prepare(`
        INSERT INTO audit (id, user, role, tool, outcome, detail, args_hash, caller, repo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertAudit.run(
        crypto.randomUUID(),
        user || 'anonymous',
        role || 'agent',
        tool,
        outcome,
        safeDetail,
        argsHash,
        caller,
        repo
      );
    } else {
      // Fallback logging for tools like health_check that do not bound to a repoPath.
      throw new Error("No repoPath provided; writing to global audit log.");
    }
  } catch (err: any) {
    try {
      const fallbackLog = path.join(process.cwd(), 'audit.fallback.log');
      const timestamp = new Date().toISOString();
      const parts = [
        `ArgsHash: ${argsHash || '-'}`,
        `Caller: ${caller || '-'}`,
        `Repo: ${repo || '-'}`,
      ].join(' | ');
      const message = `[${timestamp}] User: ${user} | Role: ${role} | Tool: ${tool} | Outcome: ${outcome}\nDetail: ${safeDetail}\n${parts}\nError: ${err.message}\n----------------------\n`;
      fs.appendFileSync(fallbackLog, message);
    } catch (e: any) {
      console.error("Failed to write audit log to DB and fallback:", e.message);
    }
  }
}

/**
 * Stable SHA-256 hash of a tool-input object for audit correlation. The hash is
 * deterministic for the same input shape, so two invocations of the same tool
 * with the same arguments produce the same args_hash — useful for spot-checking
 * the audit log against expected agent behavior.
 */
export function hashAuditArgs(toolInput: unknown): string {
  try {
    const json = JSON.stringify(toolInput ?? {}, Object.keys(toolInput as object || {}).sort());
    return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  } catch {
    return 'unhashable';
  }
}
