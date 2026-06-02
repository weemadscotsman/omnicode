"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.blindspotExplorer = blindspotExplorer;
const db_1 = require("../store/db");
const path_1 = __importDefault(require("path"));
function splitReason(reason) {
    if (reason.startsWith('skipped:')) {
        const kind = reason.slice('skipped:'.length).split(' ')[0];
        return { code: `skipped:${kind}`, severity: 'info', message: reason, hint: 'classified artifact — not parsed by design' };
    }
    const parts = reason.split('|');
    if (parts.length >= 3)
        return { code: parts[0], severity: parts[1], message: parts[2], hint: parts.slice(3).join('|').replace(/^hint=/, '') };
    if (reason.startsWith('Parse error'))
        return { code: 'PARSE_ERROR', severity: 'warn', message: reason, hint: 'partial/unsupported syntax or generated code' };
    return { code: 'UNKNOWN_BLINDSPOT', severity: 'warn', message: reason, hint: 'inspect manually' };
}
const CLASS_EXPLAIN = {
    DYNAMIC_IMPORT: "A require()/import() whose target is a runtime value, not a string literal. Static analysis can't know the file. → resolve via runtime_trace, or mark external if it's a plugin/registry load.",
    DYNAMIC_RUNTIME_REFERENCE: "Runtime/reflective access (eval, Reflect, getattr, dlopen, instance-based require). Genuinely needs execution to resolve. → wrap in a typeof/feature check or treat as an external boundary.",
    PARSE_ERROR: "The grammar hit syntax it couldn't fully parse — often partial files, exotic syntax, or generated code. → inspect the file; if it's generated, exclude it; if it's a real language gap, add a native grammar.",
    PARSE_FAILURE: "The parser failed outright on this file. → needs a working native grammar / fallback for this language.",
    UNSUPPORTED_EXTENSION: "No parser exists for this file type. → it's represented as metadata; add language support if it's source you care about.",
    DEGRADED_PARSE: "Parsed by the regex fallback (no native grammar loaded), so symbol confidence is lower. → install the native tree-sitter grammar to upgrade resolved_partial → resolved_full.",
    UNKNOWN_BLINDSPOT: "Unclassified flag — inspect manually.",
};
function specifierKind(spec) {
    if (spec.startsWith('@/') || spec.startsWith('#'))
        return { kind: 'unresolved_alias', explain: 'Path alias not wired up. → add it to tsconfig/jsconfig "paths" or your bundler resolver.' };
    if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('.'))
        return { kind: 'unresolved_relative', explain: 'A local path that did not resolve to an indexed file. → broken import, a generated/missing target, or a file the scanner excluded.' };
    if (spec.startsWith('/'))
        return { kind: 'unresolved_absolute', explain: 'Absolute path import — environment-specific. → usually external to the repo.' };
    return { kind: 'external_package', explain: 'A bare package specifier (npm/pip/gem/etc.) — not in the repo. Expected unless you index dependencies.' };
}
async function blindspotExplorer(repoPath, opts = {}) {
    const top = opts.top ?? 20;
    const explain = !!opts.explain;
    const db = (0, db_1.initDb)(repoPath);
    const totalFiles = db.prepare(`SELECT COUNT(*) c FROM files`).get().c;
    const totalBlind = db.prepare(`SELECT COUNT(*) c FROM blindspots`).get().c;
    const filesWithBlind = db.prepare(`SELECT COUNT(DISTINCT file_id) c FROM blindspots`).get().c;
    const blindRows = db.prepare(`SELECT b.reason, f.path FROM blindspots b JOIN files f ON f.id = b.file_id`).all();
    const byClass = {};
    for (const r of blindRows) {
        const p = splitReason(r.reason);
        if (!byClass[p.code])
            byClass[p.code] = { count: 0, severity: p.severity, hint: p.hint, examples: [] };
        byClass[p.code].count++;
        if (byClass[p.code].examples.length < 3)
            byClass[p.code].examples.push(path_1.default.relative(repoPath, r.path));
    }
    const unresolved = db.prepare(`
    SELECT specifier, COUNT(*) c FROM imports WHERE to_file_id IS NULL
    GROUP BY specifier ORDER BY c DESC LIMIT ?
  `).all(top);
    db.close();
    const perFileRate = totalFiles ? (filesWithBlind / totalFiles) * 100 : 0;
    const perReasonRate = totalFiles ? (totalBlind / totalFiles) * 100 : 0;
    let out = `OmniCode Blindspot Explorer — ${repoPath}\n\n`;
    out += `Blindspots are honest "I see it but can't statically resolve it" flags — they do NOT\n`;
    out += `trigger raw-source fallback, so they never cost token savings. They tell you what is\n`;
    out += `dynamic, external, or generated so an agent can handle it deliberately.\n\n`;
    out += `Files: ${totalFiles} · files with ≥1 blindspot: ${filesWithBlind} (${perFileRate.toFixed(1)}% — the honest rate)\n`;
    out += `Total blindspot reasons: ${totalBlind} (${perReasonRate.toFixed(1)}% per-reason — can exceed 100% since one file can emit several)\n\n`;
    out += `Blindspot classes (most common first):\n`;
    const classes = Object.entries(byClass).sort((a, b) => b[1].count - a[1].count);
    if (!classes.length)
        out += `  none\n`;
    for (const [code, g] of classes) {
        out += `- ${code}: ${g.count} · severity ${g.severity}\n`;
        if (explain && CLASS_EXPLAIN[code])
            out += `    why: ${CLASS_EXPLAIN[code]}\n`;
        else
            out += `    ${g.hint}\n`;
        if (g.examples.length)
            out += `    e.g. ${g.examples.join(', ')}\n`;
    }
    out += `\nTop ${top} unresolved references (imports the graph couldn't bind):\n`;
    if (!unresolved.length)
        out += `  none — every import resolved\n`;
    const kindTotals = {};
    unresolved.forEach((u, i) => {
        const k = specifierKind(u.specifier);
        kindTotals[k.kind] = (kindTotals[k.kind] || 0) + u.c;
        out += `${String(i + 1).padStart(2)}. ${u.specifier} — ${u.c}× (${k.kind})\n`;
        if (explain)
            out += `      ${k.explain}\n`;
    });
    if (Object.keys(kindTotals).length) {
        out += `\nUnresolved by kind: ${Object.entries(kindTotals).map(([k, n]) => `${k} ${n}`).join(' · ')}\n`;
    }
    if (!explain)
        out += `\nRun with --explain for per-class and per-reference guidance.\n`;
    return { result: out.trim() };
}
