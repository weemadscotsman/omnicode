"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findReferences = findReferences;
const db_1 = require("../store/db");
async function findReferences(repoPath, symbolName) {
    const db = (0, db_1.initDb)(repoPath);
    const targetSymbol = db.prepare(`SELECT * FROM symbols WHERE name = ? COLLATE NOCASE`).get(symbolName);
    if (!targetSymbol) {
        return { result: `Symbol '${symbolName}' not found in index.` };
    }
    const incoming = db.prepare(`SELECT from_symbol FROM edges WHERE to_symbol = ?`).all(targetSymbol.id);
    if (incoming.length === 0) {
        return { result: `No references found for '${symbolName}' in the exact edges index.` };
    }
    let report = `Found ${incoming.length} references for '${symbolName}':\n`;
    for (const edge of incoming) {
        const caller = db.prepare(`SELECT s.name, s.kind, f.path, s.line FROM symbols s JOIN files f ON s.file_id = f.id WHERE s.id = ?`).get(edge.from_symbol);
        if (caller) {
            report += `- ${caller.path}:${caller.line} ([${caller.kind}] ${caller.name})\n`;
        }
    }
    return { result: report };
}
