"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChurnRate = getChurnRate;
const db_1 = require("../store/db");
const child_process_1 = require("child_process");
async function getChurnRate(repoPath, symbolName) {
    const db = (0, db_1.initDb)(repoPath);
    const targetSymbol = db.prepare(`SELECT * FROM symbols WHERE name = ? COLLATE NOCASE`).get(symbolName);
    if (!targetSymbol) {
        return { result: `Symbol '${symbolName}' not found in index.` };
    }
    const fileRow = db.prepare(`SELECT path FROM files WHERE id = ?`).get(targetSymbol.file_id);
    if (!fileRow) {
        return { result: `File for symbol '${symbolName}' not found.` };
    }
    let gitOutput = '';
    try {
        const lineRef = `${targetSymbol.line},${targetSymbol.line}:${fileRow.path}`;
        const r = (0, child_process_1.spawnSync)('git', ['log', `-L${lineRef}`, '--oneline'], {
            cwd: repoPath,
            encoding: 'utf8',
        });
        if (r.status === 0 && r.stdout) {
            gitOutput = r.stdout;
        }
        else {
            throw new Error(r.stderr || 'non-zero exit');
        }
    }
    catch (err) {
        // fallback to generic file churn
        const r = (0, child_process_1.spawnSync)('git', ['log', '--oneline', fileRow.path], {
            cwd: repoPath,
            encoding: 'utf8',
        });
        if (r.status === 0 && r.stdout) {
            gitOutput = r.stdout;
        }
        else {
            return { result: `Cannot access git churn for ${fileRow.path}. Make sure it is tracked by git.` };
        }
    }
    const commitCount = gitOutput.split('\n').filter(line => line.match(/^[a-f0-9]{7,40} /i)).length;
    const risk = commitCount > 20 ? "HIGH RISK (Constant Churn)" : commitCount > 5 ? "MODERATE RISK" : "STABLE";
    return { result: `Symbol '${symbolName}' in ${fileRow.path} has been modified in approximately ${commitCount} commits.\nMaintenance status: ${risk}` };
}
