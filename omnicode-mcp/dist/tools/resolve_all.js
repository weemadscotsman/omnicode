"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAll = resolveAll;
exports.resolutionStatus = resolutionStatus;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../store/db");
const index_project_1 = require("./index_project");
const resolution_1 = require("../engine/resolution");
const RESOLVED_STATES = new Set(['resolved_full', 'resolved_partial', 'resolved_metadata', 'generated_excluded', 'unsafe_excluded']);
/**
 * Zero Unknown Files report. Runs the full ledger and emits machine + human proof
 * that every file is accounted for, every source file is resolved as deeply as
 * possible, and every unresolved case names exactly what it needs.
 */
async function resolveAll(repoPath, options = {}) {
    const reindex = options.reindex !== false;
    const write = options.write !== false;
    if (reindex)
        await (0, index_project_1.indexProject)(repoPath, undefined, {});
    const db = (0, db_1.initDb)(repoPath);
    const cov = (0, resolution_1.getResolutionCoverage)(db);
    const rows = db.prepare(`
    SELECT f.path AS path, r.kind, r.state, r.reason, r.resolver_used, r.confidence
    FROM resolution r JOIN files f ON f.id = r.file_id
    ORDER BY r.state, f.path
  `).all();
    let excludedDirs = [];
    try {
        excludedDirs = JSON.parse((0, db_1.getIndexMeta)(db, 'excluded_dirs') || '[]');
    }
    catch { /* */ }
    db.close();
    const rel = (p) => (path_1.default.isAbsolute(p) ? path_1.default.relative(repoPath, p) : p);
    const unresolved = rows.filter((r) => !RESOLVED_STATES.has(r.state));
    const gaps = rows.filter((r) => r.state === 'resolver_missing');
    // resolver_gaps: dedup the named requirements.
    const gapCounts = {};
    for (const g of gaps) {
        const req = g.reason.replace(/^.*needs /, '');
        gapCounts[req] = (gapCounts[req] || 0) + 1;
    }
    const resolutionJson = {
        generated_at: new Date().toISOString(),
        repo_path: repoPath,
        coverage: cov,
        files: rows.map((r) => ({ path: rel(r.path), kind: r.kind, state: r.state, reason: r.reason, resolver_used: r.resolver_used, confidence: r.confidence })),
    };
    const sourceCoverage = {
        source_files: cov.sourceFiles,
        source_resolved: cov.sourceResolved,
        source_resolution_coverage: Number((cov.sourceResolutionCoverage * 100).toFixed(2)),
        unresolved_source_files: cov.unresolvedSource,
        runtime_required_files: cov.runtimeRequired,
        blocking_repair_gaps: cov.blockingRepairGaps,
        unknown_files: cov.unknown,
    };
    const artifactManifest = {
        generated_at: new Date().toISOString(),
        artifacts: rows
            .filter((r) => !['source', 'route', 'test'].includes(r.kind))
            .map((r) => ({ path: rel(r.path), kind: r.kind, state: r.state, reason: r.reason })),
    };
    const report = renderReport(repoPath, cov, rows.map((r) => ({ ...r, path: rel(r.path) })), gapCounts, excludedDirs);
    if (write) {
        const outDir = options.output_dir || path_1.default.join(repoPath, '.omnicode');
        fs_1.default.mkdirSync(outDir, { recursive: true });
        fs_1.default.writeFileSync(path_1.default.join(outDir, 'RESOLUTION_REPORT.md'), report, 'utf8');
        fs_1.default.writeFileSync(path_1.default.join(outDir, 'resolution.json'), JSON.stringify(resolutionJson, null, 2), 'utf8');
        fs_1.default.writeFileSync(path_1.default.join(outDir, 'unresolved.ndjson'), unresolved.map((r) => JSON.stringify({ path: rel(r.path), kind: r.kind, state: r.state, reason: r.reason, resolver_used: r.resolver_used })).join('\n') + (unresolved.length ? '\n' : ''), 'utf8');
        fs_1.default.writeFileSync(path_1.default.join(outDir, 'resolver_gaps.md'), renderGaps(gapCounts), 'utf8');
        fs_1.default.writeFileSync(path_1.default.join(outDir, 'artifact_manifest.json'), JSON.stringify(artifactManifest, null, 2), 'utf8');
        fs_1.default.writeFileSync(path_1.default.join(outDir, 'source_coverage.json'), JSON.stringify(sourceCoverage, null, 2), 'utf8');
    }
    return { result: report, coverage: cov, source_coverage: sourceCoverage, unresolved_count: unresolved.length, resolver_gaps: gapCounts };
}
function pct(n) { return (n * 100).toFixed(1) + '%'; }
function renderReport(repoPath, cov, rows, gapCounts, excludedDirs = []) {
    const l = [];
    l.push('# OmniCode Resolution Report — Zero Unknown Files');
    l.push('');
    l.push(`Repo: ${repoPath}`);
    l.push(`Generated: ${new Date().toISOString()}`);
    l.push('');
    l.push(`Every discovered file is accounted for below. "Skipped" is not a final state.`);
    l.push('');
    l.push(`## Headline`);
    l.push(`- Files accounted for: ${cov.total}`);
    l.push(`- Unknown files (must be 0): **${cov.unknown}**`);
    l.push(cov.sourceFiles === 0
        ? `- Source resolution coverage: **n/a** — no source files (asset/data/config-only repo)`
        : `- Source resolution coverage: **${pct(cov.sourceResolutionCoverage)}** (${cov.sourceResolved}/${cov.sourceFiles} source-like files)`);
    l.push(`- Unresolved source files (need a resolver): ${cov.unresolvedSource}`);
    l.push(`- Runtime-required files: ${cov.runtimeRequired}`);
    l.push(`- Blocking repair gaps: ${cov.blockingRepairGaps}`);
    l.push('');
    l.push(`## Resolution states`);
    const stateOrder = ['resolved_full', 'resolved_partial', 'resolved_metadata', 'generated_excluded', 'unsafe_excluded', 'requires_runtime', 'resolver_missing', 'failed_with_reason'];
    for (const s of stateOrder)
        if (cov.byState[s])
            l.push(`- ${s}: ${cov.byState[s]}`);
    l.push('');
    l.push(`## File kinds`);
    for (const [k, n] of Object.entries(cov.byKind).sort((a, b) => b[1] - a[1]))
        l.push(`- ${k}: ${n}`);
    l.push('');
    if (Object.keys(gapCounts).length) {
        l.push(`## Resolver gaps (named, not vague)`);
        for (const [req, n] of Object.entries(gapCounts).sort((a, b) => b[1] - a[1]))
            l.push(`- ${req}: ${n} file(s)`);
        l.push('');
    }
    const unresolved = rows.filter((r) => !RESOLVED_STATES.has(r.state));
    if (unresolved.length) {
        l.push(`## Every unresolved file, with its named requirement`);
        for (const r of unresolved.slice(0, 200))
            l.push(`- [${r.state}] ${r.path} — ${r.reason}`);
        if (unresolved.length > 200)
            l.push(`- … and ${unresolved.length - 200} more (see unresolved.ndjson)`);
        l.push('');
    }
    // Exclusions are never silent: list every directory the scan did not descend into.
    l.push(`## Excluded directories (not indexed — by design, listed so nothing is hidden)`);
    if (!excludedDirs.length)
        l.push(`- none — the entire tree was scanned`);
    else {
        const byReason = {};
        for (const e of excludedDirs)
            (byReason[e.reason] ||= []).push(e.dir);
        for (const [reason, dirs] of Object.entries(byReason).sort((a, b) => b[1].length - a[1].length)) {
            const shown = dirs.slice(0, 15).join(', ');
            l.push(`- ${reason} (${dirs.length}): ${shown}${dirs.length > 15 ? ` … +${dirs.length - 15} more` : ''}`);
        }
        l.push(`  Override with an .omnicode config "ignorePatterns" (to add) — deps/build/vcs caches are skipped by default.`);
    }
    l.push('');
    l.push(`## Verdict`);
    if (cov.unknown === 0 && cov.blockingRepairGaps === 0)
        l.push(`PASS: every file accounted for, no source-like black holes, no blocking repair gaps.`);
    else if (cov.unknown === 0)
        l.push(`ACCOUNTED: every file is classified, but ${cov.blockingRepairGaps} file(s) need a resolver/runtime before destructive repair is safe.`);
    else
        l.push(`FAIL: ${cov.unknown} unknown file(s) remain — investigate classification.`);
    return l.join('\n') + '\n';
}
function renderGaps(gapCounts) {
    const l = ['# OmniCode Resolver Gaps', '', 'Named resolver requirements blocking deeper understanding. Build these to raise coverage.', ''];
    if (!Object.keys(gapCounts).length) {
        l.push('None — every source-like file has a working resolver.');
        return l.join('\n') + '\n';
    }
    for (const [req, n] of Object.entries(gapCounts).sort((a, b) => b[1] - a[1]))
        l.push(`- **${req}** — ${n} file(s)`);
    return l.join('\n') + '\n';
}
// Read-only variant: report from the existing index without re-indexing.
async function resolutionStatus(repoPath) {
    return resolveAll(repoPath, { reindex: false, write: false });
}
