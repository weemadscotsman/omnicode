"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAudit = logAudit;
exports.hashAuditArgs = hashAuditArgs;
const db_1 = require("../store/db");
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const redact_1 = require("./redact");
function logAudit(repoPath, user, role, tool, outcome, detail, extra = {}) {
    const safeDetail = (0, redact_1.redactSecrets)(detail);
    const argsHash = extra.argsHash || null;
    const caller = extra.caller || null;
    const repo = extra.repo || repoPath || null;
    try {
        if (repoPath) {
            const db = (0, db_1.initDb)(repoPath);
            const insertAudit = db.prepare(`
        INSERT INTO audit (id, user, role, tool, outcome, detail, args_hash, caller, repo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            insertAudit.run(crypto_1.default.randomUUID(), user || 'anonymous', role || 'agent', tool, outcome, safeDetail, argsHash, caller, repo);
        }
        else {
            // Fallback logging for tools like health_check that do not bound to a repoPath.
            throw new Error("No repoPath provided; writing to global audit log.");
        }
    }
    catch (err) {
        try {
            const fallbackLog = path_1.default.join(process.cwd(), 'audit.fallback.log');
            const timestamp = new Date().toISOString();
            const parts = [
                `ArgsHash: ${argsHash || '-'}`,
                `Caller: ${caller || '-'}`,
                `Repo: ${repo || '-'}`,
            ].join(' | ');
            const message = `[${timestamp}] User: ${user} | Role: ${role} | Tool: ${tool} | Outcome: ${outcome}\nDetail: ${safeDetail}\n${parts}\nError: ${err.message}\n----------------------\n`;
            fs_1.default.appendFileSync(fallbackLog, message);
        }
        catch (e) {
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
function hashAuditArgs(toolInput) {
    try {
        const json = JSON.stringify(toolInput ?? {}, Object.keys(toolInput || {}).sort());
        return crypto_1.default.createHash('sha256').update(json).digest('hex').slice(0, 16);
    }
    catch {
        return 'unhashable';
    }
}
