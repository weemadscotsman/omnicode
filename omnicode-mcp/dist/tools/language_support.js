"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.languageSupport = languageSupport;
const db_1 = require("../store/db");
const parser_1 = require("../engine/parser");
const repo_vision_gate_1 = require("../engine/repo_vision_gate");
async function languageSupport(repoPath) {
    const db = (0, db_1.initDb)(repoPath);
    const rows = db.prepare(`
    SELECT language_name, parser_mode, COUNT(*) AS count, ROUND(AVG(parse_quality), 3) AS quality
    FROM files
    GROUP BY language_name, parser_mode
    ORDER BY count DESC
  `).all();
    let result = `Language Support & Parsing Status:\n\n`;
    if (rows.length === 0)
        result += `No files indexed yet. Run index_project first.\n`;
    for (const row of rows) {
        const nativeLoaded = parser_1.langRegistry.isLoadedLanguageName(row.language_name);
        const fallback = parser_1.langRegistry.hasFallback(row.language_name);
        result += `- ${row.language_name || 'unknown'}: ${row.count} files · mode=${row.parser_mode} · tree-sitter=${nativeLoaded ? 'YES' : 'NO'} · fallback=${fallback ? 'YES' : 'NO'} · quality=${row.quality ?? 0}\n`;
    }
    const loaded = parser_1.langRegistry.loadedLanguages.length > 0 ? parser_1.langRegistry.loadedLanguages.join(', ') : 'none';
    result += `\nNative parsers loaded: ${loaded}\n`;
    result += `Fallback parsers available: ${parser_1.langRegistry.fallbackLanguages.join(', ')}\n`;
    result += `\n${(0, repo_vision_gate_1.formatRepoVisionGate)((0, repo_vision_gate_1.getRepoVisionGate)(db))}\n`;
    result += `\nRule: fallback means OmniCode can still extract symbols/imports/calls, but repair plans must treat those files as lower-confidence until native parser or LSP proof is available.`;
    return { result };
}
