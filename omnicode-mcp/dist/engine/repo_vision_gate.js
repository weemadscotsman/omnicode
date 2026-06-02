"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRepoVisionGate = getRepoVisionGate;
exports.formatRepoVisionGate = formatRepoVisionGate;
function getRepoVisionGate(db) {
    const fileStats = db.prepare(`
    SELECT
      COUNT(*) AS files,
      SUM(CASE WHEN parser_mode = 'tree-sitter' THEN 1 ELSE 0 END) AS tree_sitter_files,
      SUM(CASE WHEN parser_mode = 'fallback' THEN 1 ELSE 0 END) AS fallback_files,
      SUM(CASE WHEN parser_mode = 'none' THEN 1 ELSE 0 END) AS unparsed_files,
      ROUND(AVG(parse_quality), 3) AS avg_quality
    FROM files
  `).get();
    const blindspotStats = db.prepare(`
    SELECT
      COUNT(*) AS blindspots,
      SUM(CASE WHEN reason LIKE 'DYNAMIC_RUNTIME_REFERENCE|%' THEN 1 ELSE 0 END) AS dynamic_runtime_warnings,
      SUM(CASE WHEN reason LIKE '%|error|%' OR reason LIKE 'PARSE_FAILURE|%' OR reason LIKE 'UNSUPPORTED_EXTENSION|%' THEN 1 ELSE 0 END) AS parser_errors
    FROM blindspots
  `).get();
    const unresolved = db.prepare(`
    SELECT
      SUM(CASE WHEN specifier LIKE '@/%' OR specifier LIKE '#%' THEN 1 ELSE 0 END) AS unresolved_aliases,
      SUM(CASE WHEN specifier LIKE './%' OR specifier LIKE '../%' THEN 1 ELSE 0 END) AS unresolved_relative
    FROM imports
    WHERE to_file_id IS NULL
  `).get();
    const files = Number(fileStats.files || 0);
    const blindspots = Number(blindspotStats.blindspots || 0);
    const avgQuality = Number(fileStats.avg_quality || 0);
    const stats = {
        files,
        treeSitterFiles: Number(fileStats.tree_sitter_files || 0),
        fallbackFiles: Number(fileStats.fallback_files || 0),
        unparsedFiles: Number(fileStats.unparsed_files || 0),
        avgQuality,
        blindspots,
        blindspotRate: files ? (blindspots / files) * 100 : 0,
        dynamicRuntimeWarnings: Number(blindspotStats.dynamic_runtime_warnings || 0),
        parserErrors: Number(blindspotStats.parser_errors || 0),
        unresolvedAliases: Number(unresolved.unresolved_aliases || 0),
        unresolvedRelativeImports: Number(unresolved.unresolved_relative || 0),
    };
    const reasons = [];
    if (files === 0)
        reasons.push('no indexed files');
    if (stats.unparsedFiles > 0)
        reasons.push(`${stats.unparsedFiles} unparsed files`);
    if (stats.parserErrors > 0)
        reasons.push(`${stats.parserErrors} parser/error blindspots`);
    if (stats.dynamicRuntimeWarnings > 0)
        reasons.push(`${stats.dynamicRuntimeWarnings} dynamic runtime warnings`);
    if (stats.unresolvedAliases > 0)
        reasons.push(`${stats.unresolvedAliases} unresolved aliases/import maps`);
    if (stats.unresolvedRelativeImports > 0)
        reasons.push(`${stats.unresolvedRelativeImports} unresolved relative imports`);
    if (stats.fallbackFiles > 0)
        reasons.push(`${stats.fallbackFiles} fallback-parsed files`);
    if (avgQuality > 0 && avgQuality < 0.55)
        reasons.push(`low average parse quality ${avgQuality}`);
    if (stats.blindspotRate > 20)
        reasons.push(`blindspot rate ${stats.blindspotRate.toFixed(1)}%`);
    const high = files === 0 ||
        stats.unparsedFiles > 0 ||
        stats.parserErrors > 0 ||
        avgQuality < 0.55 ||
        stats.blindspotRate > 20;
    const medium = !high && (stats.fallbackFiles > 0 ||
        stats.dynamicRuntimeWarnings > 0 ||
        stats.unresolvedAliases > 0 ||
        stats.unresolvedRelativeImports > 0 ||
        stats.blindspotRate > 8);
    const risk = high ? 'HIGH' : medium ? 'MEDIUM' : 'LOW';
    return {
        risk,
        suggestionAllowed: files > 0,
        repairAllowed: risk !== 'HIGH',
        destructiveAllowed: risk === 'LOW',
        reasons,
        stats,
    };
}
function formatRepoVisionGate(gate) {
    const repair = gate.repairAllowed ? 'ALLOW guarded repair planning' : 'BLOCK repair planning until repo vision improves';
    const destructive = gate.destructiveAllowed ? 'ALLOW delete/rename candidates after normal dependency proof' : 'BLOCK delete/rename/destructive edits';
    const reasons = gate.reasons.length ? gate.reasons.join('; ') : 'no confidence blockers';
    return [
        `Repair Gate: risk ${gate.risk}`,
        `- Suggestions: ${gate.suggestionAllowed ? 'ALLOW' : 'BLOCK'}`,
        `- Repair plans: ${repair}`,
        `- Destructive actions: ${destructive}`,
        `- Reasons: ${reasons}`,
    ].join('\n');
}
