"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCallHierarchy = getCallHierarchy;
const db_1 = require("../store/db");
async function getCallHierarchy(repoPath, symbolName, maxDepth = 2) {
    const db = (0, db_1.initDb)(repoPath);
    const startSymbol = db.prepare(`SELECT * FROM symbols WHERE name = ? COLLATE NOCASE`).get(symbolName);
    if (!startSymbol) {
        return { result: `Symbol '${symbolName}' not found in index.` };
    }
    let resultString = `Call Hierarchy for [${startSymbol.kind}] ${startSymbol.name}:\n\n`;
    // Walk Down (Callees)
    resultString += `CALLEES (What ${startSymbol.name} calls):\n`;
    let downVisited = new Set();
    function walkDown(symName, depth) {
        if (depth > maxDepth)
            return;
        if (downVisited.has(symName))
            return;
        downVisited.add(symName);
        const edges = db.prepare(`SELECT to_symbol FROM call_edges WHERE from_symbol = ?`).all(symName);
        for (const edge of edges) {
            resultString += `${'  '.repeat(depth)}- ${edge.to_symbol}\n`;
            walkDown(edge.to_symbol, depth + 1);
        }
    }
    walkDown(startSymbol.name, 1);
    if (downVisited.size <= 1) {
        resultString += `  (No explicit function calls detected mapped within AST)\n`;
    }
    resultString += `\nCALLERS (Who calls ${startSymbol.name}):\n`;
    let upVisited = new Set();
    function walkUp(symName, depth) {
        if (depth > maxDepth)
            return;
        if (upVisited.has(symName))
            return;
        upVisited.add(symName);
        const edges = db.prepare(`SELECT from_symbol FROM call_edges WHERE to_symbol = ?`).all(symName);
        for (const edge of edges) {
            resultString += `${'  '.repeat(depth)}- ${edge.from_symbol}\n`;
            walkUp(edge.from_symbol, depth + 1);
        }
    }
    walkUp(startSymbol.name, 1);
    if (upVisited.size <= 1) {
        resultString += `  (No specific callers found in AST. It might be uncalled or a top-level route/export.)\n`;
    }
    return { result: resultString };
}
