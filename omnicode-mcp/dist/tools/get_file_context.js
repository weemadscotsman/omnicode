"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFileContext = getFileContext;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../store/db");
const output_budget_1 = require("../engine/output_budget");
function findFile(db, repoPath, filePath) {
    const abs = path_1.default.isAbsolute(filePath) ? path_1.default.resolve(filePath) : path_1.default.resolve(repoPath, filePath);
    return (db.prepare(`SELECT id, path, lang, lines, parser_mode, parse_quality FROM files WHERE path = ?`).get(abs) ||
        db.prepare(`SELECT id, path, lang, lines, parser_mode, parse_quality FROM files WHERE path LIKE ? ORDER BY LENGTH(path) ASC LIMIT 1`).get(`%${filePath}`));
}
function readBudgetedFile(filePath, maxTokens) {
    const content = fs_1.default.readFileSync(filePath, 'utf8');
    const tokens = (0, output_budget_1.estimateTokens)(content);
    if (tokens <= maxTokens)
        return { content, tokens, truncated: false };
    const maxChars = Math.max(400, maxTokens * 4);
    return {
        content: content.slice(0, maxChars).trimEnd() + `\n\n/* [TRUNCATED: file exceeded ${maxTokens} token budget] */`,
        tokens: maxTokens,
        truncated: true,
    };
}
function rel(repoPath, filePath) {
    return path_1.default.relative(repoPath, filePath).replace(/\\/g, '/');
}
async function getFileContext(repoPath, filePath, max_tokens = 6000, dependency_limit = 12) {
    const resolvedRepo = path_1.default.resolve(repoPath);
    const db = (0, db_1.initDb)(resolvedRepo);
    const file = findFile(db, resolvedRepo, filePath);
    if (!file)
        return { result: `File '${filePath}' not found in index. Run index_project first or check the path.` };
    (0, db_1.recordFileTouch)(db, file.path, 'pull');
    const maxDeps = Math.max(0, Math.min(Number(dependency_limit) || 12, 50));
    const totalBudget = Math.max(1000, Number(max_tokens) || 6000);
    const requestedBudget = Math.max(500, Math.floor(totalBudget * 0.65));
    const depBudget = Math.max(250, Math.floor((totalBudget - requestedBudget) / Math.max(1, maxDeps)));
    const requested = readBudgetedFile(file.path, requestedBudget);
    let used = (0, output_budget_1.estimateTokens)(requested.content);
    const deps = db.prepare(`
    SELECT DISTINCT f.id, f.path, f.lang, f.lines, f.parser_mode, f.parse_quality, f.pagerank
    FROM imports i
    JOIN files f ON f.id = i.to_file_id
    WHERE i.from_file_id = ?
    ORDER BY f.pagerank DESC, f.path ASC
    LIMIT ?
  `).all(file.id, maxDeps);
    const blocks = [];
    const depMeta = [];
    for (const dep of deps) {
        if (used >= totalBudget)
            break;
        try {
            const remaining = Math.max(250, totalBudget - used);
            const budget = Math.min(depBudget, remaining);
            const packed = readBudgetedFile(dep.path, budget);
            const block = [
                `\n\n--- DIRECT DEPENDENCY: ${rel(resolvedRepo, dep.path)} ---`,
                `lang=${dep.lang || 'unknown'} parser=${dep.parser_mode || 'unknown'} quality=${dep.parse_quality ?? 0} pagerank=${Number(dep.pagerank || 0).toFixed(4)}`,
                packed.content,
            ].join('\n');
            const blockTokens = (0, output_budget_1.estimateTokens)(block);
            if (used + blockTokens > totalBudget)
                break;
            blocks.push(block);
            used += blockTokens;
            depMeta.push({
                path: rel(resolvedRepo, dep.path),
                tokens: packed.tokens,
                truncated: packed.truncated,
                parser_mode: dep.parser_mode,
                parse_quality: dep.parse_quality,
            });
        }
        catch {
            depMeta.push({ path: rel(resolvedRepo, dep.path), error: 'read_failed' });
        }
    }
    const header = [
        `# OmniCode File Context`,
        ``,
        `requested_file: ${rel(resolvedRepo, file.path)}`,
        `language: ${file.lang || 'unknown'}`,
        `parser_mode: ${file.parser_mode || 'unknown'}`,
        `parse_quality: ${file.parse_quality ?? 0}`,
        `direct_dependencies_returned: ${depMeta.length}/${deps.length}`,
        `estimated_tokens_returned: ${used}`,
        `budget: ${totalBudget}`,
        ``,
        `--- REQUESTED FILE ---`,
    ].join('\n');
    const text = `${header}\n${requested.content}${blocks.join('')}`;
    return {
        result: text,
        _meta: {
            requested_file: rel(resolvedRepo, file.path),
            direct_dependencies: depMeta,
            max_tokens: totalBudget,
            used_tokens: (0, output_budget_1.estimateTokens)(text),
            requested_truncated: requested.truncated,
        },
    };
}
