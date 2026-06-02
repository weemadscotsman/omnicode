"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.blindspotReport = blindspotReport;
const db_1 = require("../store/db");
const path_1 = __importDefault(require("path"));
const repo_vision_gate_1 = require("../engine/repo_vision_gate");
function splitReason(reason) {
    const parts = reason.split('|');
    if (parts.length >= 3) {
        return { code: parts[0], severity: parts[1], message: parts[2], hint: parts.slice(3).join('|').replace(/^hint=/, '') };
    }
    if (reason.startsWith('Parse error near line'))
        return { code: 'PARSE_ERROR', severity: 'warn', message: reason, hint: 'inspect syntax/generated file' };
    if (reason.startsWith('Failed to parse'))
        return { code: 'PARSE_FAILURE', severity: 'error', message: reason, hint: 'fallback parser or native grammar needed' };
    if (reason.includes('Unsupported extension'))
        return { code: 'UNSUPPORTED_EXTENSION', severity: 'error', message: reason, hint: 'add scanner/parser support or ignore file type' };
    return { code: 'UNKNOWN_BLINDSPOT', severity: 'warn', message: reason, hint: 'inspect manually' };
}
async function blindspotReport(repoPath) {
    const db = (0, db_1.initDb)(repoPath);
    const fileStats = db.prepare(`
    SELECT
      COUNT(*) AS files,
      SUM(CASE WHEN parser_mode = 'tree-sitter' THEN 1 ELSE 0 END) AS tree_sitter_files,
      SUM(CASE WHEN parser_mode = 'fallback' THEN 1 ELSE 0 END) AS fallback_files,
      SUM(CASE WHEN parser_mode = 'none' THEN 1 ELSE 0 END) AS unparsed_files,
      ROUND(AVG(parse_quality), 3) AS avg_quality
    FROM files
  `).get();
    const unresolvedImports = db.prepare(`
    SELECT i.specifier, f.path as file_path
    FROM imports i
    JOIN files f ON i.from_file_id = f.id
    WHERE i.to_file_id IS NULL
    ORDER BY f.path
    LIMIT 200
  `).all();
    const blindspots = db.prepare(`
    SELECT b.reason, f.path as file_path, f.lang, f.parser_mode, f.parse_quality, f.language_name
    FROM blindspots b
    JOIN files f ON b.file_id = f.id
    ORDER BY f.path
  `).all();
    const parserRows = db.prepare(`
    SELECT language_name, parser_mode, COUNT(*) AS count, ROUND(AVG(parse_quality), 3) AS quality
    FROM files
    GROUP BY language_name, parser_mode
    ORDER BY count DESC
  `).all();
    const grouped = {};
    for (const b of blindspots) {
        const parsed = splitReason(b.reason);
        const key = parsed.code;
        if (!grouped[key])
            grouped[key] = { count: 0, severity: parsed.severity, hint: parsed.hint, examples: [] };
        grouped[key].count++;
        if (grouped[key].examples.length < 5)
            grouped[key].examples.push(`${path_1.default.relative(repoPath, b.file_path)} :: ${parsed.message}`);
    }
    const unresolvedByKind = {};
    for (const u of unresolvedImports) {
        const kind = u.specifier.startsWith('.') ? 'relative_unresolved' : u.specifier.startsWith('@/') ? 'alias_unresolved' : 'package_or_external';
        unresolvedByKind[kind] = (unresolvedByKind[kind] || 0) + 1;
    }
    const totalFiles = Number(fileStats.files || 0);
    const blindspotRate = totalFiles ? (blindspots.length / totalFiles) * 100 : 0;
    const unresolvedRate = totalFiles ? (unresolvedImports.length / totalFiles) * 100 : 0;
    const risk = blindspotRate > 20 || Number(fileStats.avg_quality || 0) < 0.55 ? 'HIGH' : blindspotRate > 8 || unresolvedRate > 20 ? 'MEDIUM' : 'LOW';
    const gate = (0, repo_vision_gate_1.getRepoVisionGate)(db);
    let report = `OmniCode Repo Vision / Blindspot Report\n\n`;
    report += `Coverage: ${fileStats.tree_sitter_files || 0} tree-sitter · ${fileStats.fallback_files || 0} fallback · ${fileStats.unparsed_files || 0} unparsed · avg quality ${fileStats.avg_quality ?? 0}\n`;
    report += `Blindspots: ${blindspots.length} (${blindspotRate.toFixed(1)}% of indexed files) · unresolved imports sampled: ${unresolvedImports.length} · risk ${risk}\n\n`;
    report += `${(0, repo_vision_gate_1.formatRepoVisionGate)(gate)}\n\n`;
    report += `Parser coverage by language:\n`;
    for (const row of parserRows)
        report += `- ${row.language_name || 'unknown'} / ${row.parser_mode}: ${row.count} files · quality ${row.quality ?? 0}\n`;
    report += `\nBlindspot classes:\n`;
    if (Object.keys(grouped).length === 0)
        report += `- none recorded\n`;
    for (const [code, g] of Object.entries(grouped).sort((a, b) => b[1].count - a[1].count)) {
        report += `- ${code}: ${g.count} · severity ${g.severity} · fix: ${g.hint || 'inspect'}\n`;
        for (const ex of g.examples)
            report += `  • ${ex}\n`;
    }
    // Connectivity is a separate axis from parse confidence: a file can parse
    // perfectly and still be wired to nothing. Orphan ≠ broken — it's often staged.
    const conn = (0, db_1.getConnectivityCounts)(db);
    const connOrder = ['CONNECTED', 'SOURCE_ONLY', 'SINK_ONLY', 'ORPHAN_STAGED', 'ORPHAN_INERT', 'ORPHAN_CONFIG'];
    report += `\nConnectivity (separate axis — orphan is not a parse failure):\n`;
    if (Object.keys(conn).length === 0)
        report += `- not computed (re-index to populate)\n`;
    else
        for (const k of connOrder)
            if (conn[k])
                report += `- ${k.toLowerCase()}: ${conn[k]}\n`;
    const staged = (0, db_1.getStagedFiles)(db, 10);
    if (staged.length > 0) {
        report += `\nStaged context (parses clean, not wired yet — ranked by learned intent):\n`;
        for (const s of staged) {
            const flag = s.intent_score >= 0.5 ? '  ← you keep reaching for this' : '';
            report += `- ${path_1.default.relative(repoPath, s.path)} · exports ${s.export_count} · touched ${s.touch_count}x · intent ${s.intent_score.toFixed(2)}${flag}\n`;
        }
        report += `Note: staged files are never auto-deleted on graph evidence alone; intent guards them.\n`;
    }
    report += `\nUnresolved import categories:\n`;
    if (Object.keys(unresolvedByKind).length === 0)
        report += `- none in sample\n`;
    for (const [kind, count] of Object.entries(unresolvedByKind))
        report += `- ${kind}: ${count}\n`;
    report += `\nNext fixes:\n`;
    if ((fileStats.fallback_files || 0) > 0)
        report += `- Install native tree-sitter grammars for fallback languages to raise semantic confidence.\n`;
    if ((unresolvedByKind['alias_unresolved'] || 0) > 0)
        report += `- Add/verify tsconfig/vite/webpack alias resolver for @/ and workspace aliases.\n`;
    if ((grouped['DYNAMIC_RUNTIME_REFERENCE']?.count || 0) > 0)
        report += `- Use runtime_trace/LSP/ABI resolver before repair actions that touch dynamic symbols.\n`;
    if ((grouped['PARSE_ERROR']?.count || 0) > 0)
        report += `- Inspect generated/partial files or add grammar support for syntax variant.\n`;
    if (risk === 'LOW')
        report += `- Repo vision is good enough for token-saving queries; keep blindspot warnings attached to repair plans.\n`;
    return { result: report.trim() };
}
