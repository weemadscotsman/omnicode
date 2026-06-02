"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSymbol = getSymbol;
const db_1 = require("../store/db");
async function getSymbol(repoPath, symbolName) {
    const db = (0, db_1.initDb)(repoPath);
    const symbols = db.prepare(`
    SELECT s.name, s.kind, s.snippet, f.path, s.line
    FROM symbols s
    JOIN files f ON s.file_id = f.id
    WHERE s.name = ?
    LIMIT 10
  `).all(symbolName);
    if (symbols.length === 0) {
        return { result: `Symbol '${symbolName}' not found.` };
    }
    const formatted = symbols.map(s => {
        let agentHint = "";
        if (s.kind === 'function' || s.kind === 'method') {
            agentHint = "Agent Hint: This is callable. Consider its blast radius before renaming.";
        }
        else if (s.kind === 'class') {
            agentHint = "Agent Hint: This is a structural blueprint. Use file_outline to see its methods.";
        }
        else {
            agentHint = "Agent Hint: Treat variables/exports carefully regarding downstream module imports.";
        }
        return `--- ${s.path}:${s.line} ---\n// [MUNCH AGENT HINT: ${agentHint}]\n${s.snippet}\n`;
    }).join('\n');
    return { result: formatted };
}
