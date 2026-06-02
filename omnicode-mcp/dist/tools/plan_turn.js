"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planTurn = planTurn;
const db_1 = require("../store/db");
const repo_map_1 = require("./repo_map");
const dead_code_scan_1 = require("./dead_code_scan");
async function planTurn(repoPath, intent, targetSymbol) {
    const db = (0, db_1.initDb)(repoPath);
    let plan = `--- PLAN TURN: ${intent.toUpperCase()} ---\n\n`;
    if (intent === 'explore') {
        const mapResult = await (0, repo_map_1.repoMap)(repoPath);
        plan += `Repository Map:\n${mapResult.result}\n\n`;
        // Top 5 essential/architectural symbols based on importance_score
        const topHubs = db.prepare(`
      SELECT s.name, s.kind, f.path, s.importance_score
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      ORDER BY s.importance_score DESC
      LIMIT 10
    `).all();
        if (topHubs.length > 0) {
            plan += `Top 10 Architectural Hubs to review first:\n`;
            for (const hub of topHubs) {
                plan += `- [${hub.kind}] ${hub.name} (Score: ${hub.importance_score}) in ${hub.path}\n`;
            }
        }
        plan += `\nRecommendation: Use 'file_outline' on these core files, then 'get_context_bundle' on the symbols you need to modify.`;
        return { result: plan };
    }
    if (intent === 'audit') {
        const deadCodeResult = await (0, dead_code_scan_1.deadCodeScan)(repoPath);
        plan += `Dead Code Scan:\n${deadCodeResult.result}\n\n`;
        plan += `Recommendation: Check 'blast_radius' for the listed dead symbols before definitively removing them.`;
        return { result: plan };
    }
    return {
        result: `Unknown intent: '${intent}'. Valid intents are 'explore', 'audit'. For deep dives on specific symbols, use 'get_context_bundle'.`
    };
}
