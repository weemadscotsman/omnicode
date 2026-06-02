"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFileSlice = getFileSlice;
const db_1 = require("../store/db");
const fs_1 = __importDefault(require("fs"));
// Simple LRU cache for file slices to prevent disk thrashing
const sliceCache = new Map();
async function getFileSlice(repoPath, filePath, startLine, endLine, max_tokens = 4000) {
    const db = (0, db_1.initDb)(repoPath);
    const file = db.prepare(`SELECT id, path FROM files WHERE path LIKE ? LIMIT 1`).get(`%${filePath}`);
    if (!file) {
        return { result: `File '${filePath}' not found in index.` };
    }
    const cacheKey = `${file.path}:${startLine}:${endLine}:${max_tokens}`;
    if (sliceCache.has(cacheKey)) {
        return sliceCache.get(cacheKey).data;
    }
    try {
        const content = fs_1.default.readFileSync(file.path, 'utf8');
        const lines = content.split('\n');
        let targetLines = lines.slice(Math.max(0, startLine - 1), Math.min(lines.length, endLine));
        let resultText = targetLines.join('\n');
        let usedTokens = resultText.length / 4;
        let truncated = false;
        if (usedTokens > max_tokens) {
            resultText = `// [BUDGET CONTROL: max_tokens=${max_tokens} triggered]\n`;
            resultText += `// FILE SLICE EXCEEDED BUDGET. Packing most important symbols from this range instead.\n\n`;
            usedTokens = resultText.length / 4;
            truncated = true;
            const symbolsInSlice = db.prepare(`
        SELECT name, kind, line, snippet, importance_score 
        FROM symbols 
        WHERE file_id = ? AND line >= ? AND line <= ? 
        ORDER BY importance_score DESC
      `).all(file.id, startLine, endLine);
            let packedSymbols = 0;
            for (const s of symbolsInSlice) {
                const block = `[Line ${s.line}] ${s.kind} ${s.name}:\n${s.snippet}\n\n`;
                const blockTokens = block.length / 4;
                if (usedTokens + blockTokens > max_tokens) {
                    continue;
                }
                resultText += block;
                usedTokens += blockTokens;
                packedSymbols++;
            }
            if (packedSymbols === 0) {
                resultText += `// No symbols fitted in the budget. Please request a smaller slice.\n`;
            }
        }
        const res = { result: resultText, _meta: { truncated, max_tokens, used_tokens: Math.round(usedTokens) } };
        sliceCache.set(cacheKey, { time: Date.now(), data: res });
        // Keep cache tiny
        if (sliceCache.size > 50) {
            const oldestKey = Array.from(sliceCache.keys())[0];
            sliceCache.delete(oldestKey);
        }
        return res;
    }
    catch (err) {
        return { result: `Error reading file slice: ${err.message}` };
    }
}
