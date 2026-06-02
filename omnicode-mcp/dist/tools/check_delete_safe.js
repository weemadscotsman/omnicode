"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDeleteSafe = checkDeleteSafe;
const db_1 = require("../store/db");
async function checkDeleteSafe(repoPath, symbolName) {
    const db = (0, db_1.initDb)(repoPath);
    const targetSymbol = db.prepare(`SELECT * FROM symbols WHERE name = ? COLLATE NOCASE`).get(symbolName);
    if (!targetSymbol) {
        return { result: `Symbol '${symbolName}' not found in index.` };
    }
    const incoming = db.prepare(`SELECT from_symbol FROM edges WHERE to_symbol = ?`).all(targetSymbol.id);
    if (incoming.length === 0) {
        return { result: `Verdict: SAFE TO DELETE. '${symbolName}' has no incoming dependencies across the indexed repository.` };
    }
    let report = `Verdict: NOT SAFE TO DELETE. '${symbolName}' is used by ${incoming.length} other symbols:\n`;
    for (const edge of incoming) {
        const caller = db.prepare(`SELECT s.name, s.kind, f.path FROM symbols s JOIN files f ON s.file_id = f.id WHERE s.id = ?`).get(edge.from_symbol);
        if (caller) {
            report += `- [${caller.kind}] ${caller.name} in ${caller.path}\n`;
        }
    }
    report += `\nRecommendation: You must update or remove these references before deleting '${symbolName}'.`;
    return { result: report };
}
