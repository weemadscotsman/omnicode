"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getContextBundle = getContextBundle;
const db_1 = require("../store/db");
const ocap_1 = require("../engine/ocap");
async function getContextBundle(repoPath, symbolName, max_tokens = 4000, format = 'auto') {
    const db = (0, db_1.initDb)(repoPath);
    // 1. Get the target symbol
    const symbolRow = db.prepare(`SELECT id, file_id, name, kind, snippet, line, importance_score FROM symbols WHERE name = ? COLLATE NOCASE`).get(symbolName);
    if (!symbolRow) {
        return { result: `Symbol ${symbolName} not found in index.` };
    }
    const fileRow = db.prepare(`SELECT path FROM files WHERE id = ?`).get(symbolRow.file_id);
    // 2. Outgoing call edges (callees)
    const callees = db.prepare(`
    SELECT s.name, s.kind, s.snippet, s.importance_score, f.path
    FROM call_edges e
    JOIN symbols s ON e.to_symbol = s.name
    JOIN files f ON s.file_id = f.id
    WHERE e.from_symbol = ?
    GROUP BY s.name
    ORDER BY s.importance_score DESC
  `).all(symbolRow.name);
    // 3. Incoming call edges (callers)
    const callers = db.prepare(`
    SELECT s.name, s.kind, s.snippet, s.importance_score, f.path
    FROM call_edges e
    JOIN symbols s ON e.from_symbol = s.name
    JOIN files f ON s.file_id = f.id
    WHERE e.to_symbol = ?
    GROUP BY s.name
    ORDER BY s.importance_score DESC
  `).all(symbolRow.name);
    const candidates = [...callers.map(c => ({ ...c, rel: 'CALLER' })), ...callees.map(c => ({ ...c, rel: 'CALLEE' }))];
    candidates.sort((a, b) => b.importance_score - a.importance_score);
    const resolvedFormat = (0, ocap_1.resolveOcapFormat)(format, candidates.length);
    if (resolvedFormat === 'ocap') {
        const ocap = (0, ocap_1.makeOcapBuilder)('get_context_bundle', ['rel', 'name', 'kind', 'path', 'line', 'importance']);
        const targetKindId = ocap.intern('kind', symbolRow.kind);
        const targetPathId = ocap.intern('path', fileRow.path);
        // Target symbol first (rel=TARGET)
        ocap.push(['TARGET', symbolRow.name, targetKindId, targetPathId, symbolRow.line, Number((symbolRow.importance_score || 0).toFixed(4))]);
        for (const c of candidates) {
            const kindId = ocap.intern('kind', c.kind);
            const pathId = ocap.intern('path', c.path);
            ocap.push([c.rel, c.name, kindId, pathId, 0, Number((c.importance_score || 0).toFixed(4))]);
        }
        ocap.setFooter('target', symbolRow.name);
        ocap.setFooter('max_tokens', max_tokens);
        ocap.setFooter('related', candidates.length);
        return {
            result: ocap.toText(),
            _meta: { truncated: false, max_tokens, format: 'ocap' },
        };
    }
    let formatted = `Context Bundle for [${symbolRow.kind}] ${symbolRow.name}:\n`;
    formatted += `Defined in: ${fileRow.path}:${symbolRow.line}\n`;
    formatted += `\n--- SOURCE ---\n${symbolRow.snippet}\n`;
    let usedTokens = formatted.length / 4;
    let truncated = false;
    if (candidates.length > 0) {
        formatted += `\n--- RELATED SYMBOLS (Ranked by Importance) ---\n`;
        for (const c of candidates) {
            const block = `\n[${c.rel}] ${c.kind} ${c.name} in ${c.path}:\n${c.snippet}\n`;
            const blockTokens = block.length / 4;
            if (usedTokens + blockTokens > max_tokens) {
                truncated = true;
                break;
            }
            formatted += block;
            usedTokens += blockTokens;
        }
    }
    if (truncated) {
        formatted += `\n... [TRUNCATED] Reached max_tokens budget of ${max_tokens} ...\n`;
    }
    db.close();
    return {
        result: formatted,
        _meta: { truncated, max_tokens, used_tokens: Math.round(usedTokens) },
    };
}
