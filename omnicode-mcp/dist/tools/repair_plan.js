"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.repairPlan = repairPlan;
const db_1 = require("../store/db");
const resolution_1 = require("../engine/resolution");
const repo_vision_gate_1 = require("../engine/repo_vision_gate");
const manifest_scanner_1 = require("../engine/manifest_scanner");
const session_memory_1 = require("../engine/session_memory");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
async function repairPlan(repoPath, options = {}) {
    const db = (0, db_1.initDb)(repoPath);
    try {
        const gate = (0, repo_vision_gate_1.getRepoVisionGate)(db);
        const destructive = !!options.destructive || options.intent === 'delete' || options.intent === 'rename' || options.intent === 'dead_code';
        const scan = (0, manifest_scanner_1.scanRepoManifests)(repoPath);
        let markdown = `# No Spaghett Repair Handoff\n\n`;
        markdown += `Purpose: advisory handoff for an AI agent or human operator.\n`;
        markdown += `Mutation policy: NO CODE CHANGES WERE PERFORMED BY NO SPAGHETT.\n`;
        markdown += `This file explains what to inspect, what is forbidden, and what proof is required before any separate agent applies patches.\n\n`;
        markdown += `Intent: ${options.intent || 'general'}\n`;
        markdown += `Target: ${options.target || 'repo'}\n\n`;
        markdown += `${(0, repo_vision_gate_1.formatRepoVisionGate)(gate)}\n\n`;
        markdown += `Repo Understanding:\n${(0, manifest_scanner_1.summarizeManifestScan)(scan, repoPath)}\n\n`;
        if (!gate.suggestionAllowed) {
            markdown += `Verdict: BLOCKED.\nNo indexed files are available. Run index_project first.\n`;
            return writeHandoff(repoPath, markdown, options.output_path);
        }
        // Partial index = the scanner hit a guard and did NOT see the whole repo.
        // You can navigate it, but you cannot safely delete/rename against it: a
        // reference could live in the unscanned remainder. Good enough to navigate,
        // not good enough to delete.
        const partialIndex = (0, db_1.getIndexMeta)(db, 'partial_index') === '1';
        if (partialIndex && destructive) {
            const stop = (0, db_1.getIndexMeta)(db, 'scan_stop_reason') || 'a scan guard';
            markdown += `Verdict: REFUSE DESTRUCTIVE REPAIR (PARTIAL INDEX).\n`;
            markdown += `Reason: this index is partial — the scan stopped at '${stop}', so part of the repo was never parsed. A symbol that looks unused/safe here may be referenced in the unscanned remainder.\n`;
            markdown += `Allowed now: navigation, analysis, and suggested outlines over the indexed portion.\n`;
            markdown += `Forbidden now: delete, rename, remove exports, or any destructive edit until a COMPLETE index exists.\n`;
            markdown += `Next proof needed: resume index_project until partial_index = 0 and scan_stop_reason is empty.\n`;
            return writeHandoff(repoPath, markdown, options.output_path);
        }
        // Resolution gate: a destructive change to a file that is not fully understood
        // is forbidden. Unknown/runtime-required/resolver-missing/failed → no delete/rename.
        if (destructive && options.target) {
            const res = (0, resolution_1.getResolutionForPath)(db, repoPath, options.target);
            if (res && (res.state === 'resolver_missing' || res.state === 'requires_runtime' || res.state === 'failed_with_reason')) {
                markdown += `Verdict: REFUSE DESTRUCTIVE REPAIR (UNRESOLVED FILE).\n`;
                markdown += `Reason: target is '${res.state}' — ${res.reason}.\n`;
                markdown += `A file OmniCode does not fully understand cannot be safely deleted/renamed: a reference may live in the part it can't yet resolve.\n`;
                markdown += `Next proof needed: ${res.state === 'resolver_missing' ? 'build the named resolver, then re-run resolve_all' : res.state === 'requires_runtime' ? 'supply runtime/LSP/ABI resolution for the dynamic references' : 'fix the recorded parse failure and re-index'}.\n`;
                return writeHandoff(repoPath, markdown, options.output_path);
            }
            if (res && res.kind === 'generated') {
                markdown += `Verdict: REFUSE DESTRUCTIVE REPAIR (GENERATED FILE).\n`;
                markdown += `Reason: target is a generated/build artifact — edit the generator/source, not the output.\n`;
                return writeHandoff(repoPath, markdown, options.output_path);
            }
        }
        // Per-file trust guard: even on a LOW-risk complete index, a staged or
        // high-intent target is shielded from graph-only destructive evidence.
        if (destructive && options.target) {
            const targetPath = path_1.default.isAbsolute(options.target) ? options.target : path_1.default.join(repoPath, options.target);
            const prot = (0, db_1.getFileProtection)(db, targetPath);
            if (prot.protected) {
                markdown += `Verdict: REFUSE DESTRUCTIVE REPAIR (PROTECTED FILE).\n`;
                markdown += `Reason: ${prot.reason}.\n`;
                markdown += `The dependency graph showing this file as unreferenced is NOT sufficient to delete/rename it. Intent overrides graph evidence here.\n`;
                markdown += `Allowed now: ask the user whether this file is still wanted; analyze it; leave it in place.\n`;
                markdown += `Forbidden now: delete, rename, or strip exports from this file on "unused" evidence alone.\n`;
                return writeHandoff(repoPath, markdown, options.output_path);
            }
        }
        if (destructive && !gate.destructiveAllowed) {
            markdown += `Verdict: REFUSE DESTRUCTIVE REPAIR.\n`;
            markdown += `Reason: repo vision is ${gate.risk}; destructive edits require LOW risk, resolved imports, and strong parser coverage.\n`;
            markdown += `Allowed now: non-destructive analysis, suggested patch outline, targeted resolver work, and verification planning.\n`;
            markdown += `Forbidden now: delete files, rename symbols, remove exports, collapse modules, or rewrite dynamic/fallback-parsed files.\n`;
            markdown += `Next proof needed: reduce blocking blindspots, resolve aliases/relative imports, and re-run blindspot_report.\n`;
            return writeHandoff(repoPath, markdown, options.output_path);
        }
        if (!gate.repairAllowed) {
            markdown += `Verdict: BLOCK REPAIR HANDOFF.\n`;
            markdown += `Reason: parser quality or blindspot rate is too weak for actionable patch planning.\n`;
            markdown += `Next proof needed: improve manifest/resolver coverage and re-index.\n`;
            return writeHandoff(repoPath, markdown, options.output_path);
        }
        const hotspotRows = db.prepare(`
      SELECT s.name, s.kind, f.path, ROUND(COALESCE(s.importance_score, 0), 2) AS score
      FROM symbols s
      JOIN files f ON s.file_id = f.id
      ORDER BY COALESCE(s.importance_score, 0) DESC
      LIMIT 8
    `).all();
        markdown += `Verdict: WRITE ADVISORY HANDOFF ONLY.\n`;
        markdown += `No Spaghett does not apply patches. A separate AI agent or human must read this file and perform any changes.\n`;
        markdown += `Allowed files for a separate repair agent: files with tree-sitter parse mode, resolved dependency evidence, and no dynamic runtime warning.\n`;
        markdown += `Forbidden files for a separate repair agent: fallback-parsed, unparsed, dynamic-runtime, unresolved-alias, and generated files until separately proven.\n\n`;
        markdown += `Recommended Handoff Steps:\n`;
        markdown += `1. Gather evidence with repo_map, dependency_map/blast_radius, and targeted file_outline.\n`;
        markdown += `2. Produce a smallest-change patch plan with explicit files and rollback command.\n`;
        markdown += `3. Ask the user before applying patches in a separate worker/tool.\n`;
        markdown += `4. Run existing build/test commands before and after any separate patch.\n`;
        markdown += `5. Re-run spaghetti_report and blindspot_report to measure delta.\n\n`;
        markdown += `High-impact symbols to inspect first:\n`;
        markdown += hotspotRows.length
            ? hotspotRows.map((r) => `- [${r.kind}] ${r.name} score=${r.score} in ${r.path}`).join('\n')
            : '- none indexed';
        markdown += `\n\nExpected separate-agent proof output: evidence, confidence, allowed files, forbidden files, patch steps, verification commands, rollback plan, repo-health delta, token-reduction delta.`;
        return writeHandoff(repoPath, markdown, options.output_path);
    }
    finally {
        db.close();
    }
}
function writeHandoff(repoPath, markdown, outputPath) {
    const outPath = outputPath
        ? path_1.default.resolve(repoPath, outputPath)
        : path_1.default.join(repoPath, '.omnicode', 'NO_SPAGHETT_REPAIR_HANDOFF.md');
    const repoRoot = path_1.default.resolve(repoPath);
    const resolved = path_1.default.resolve(outPath);
    if (!resolved.toLowerCase().startsWith(repoRoot.toLowerCase() + path_1.default.sep)) {
        throw new Error('repair_plan output_path must stay inside the repository');
    }
    fs_1.default.mkdirSync(path_1.default.dirname(resolved), { recursive: true });
    fs_1.default.writeFileSync(resolved, markdown, 'utf8');
    const refused = /Verdict:\s+(REFUSE|BLOCK)/.test(markdown);
    try {
        (0, session_memory_1.appendMemoryEvent)(repoPath, {
            type: 'handoff.generated',
            summary: `No Spaghett repair handoff written to ${path_1.default.relative(repoPath, resolved)}`,
            source: 'repair_plan',
            data: { path: resolved, refused },
        });
        if (refused) {
            (0, session_memory_1.appendMemoryEvent)(repoPath, {
                type: 'repair.refused',
                summary: 'No Spaghett refused repair because proof gates were not satisfied.',
                source: 'repair_plan',
                data: { path: resolved },
            });
        }
    }
    catch {
        // Memory is best-effort; handoff writing must not fail because audit memory failed.
    }
    return {
        result: `No Spaghett generated an advisory handoff file only.\n` +
            `No code repairs were performed.\n` +
            `Markdown handoff: ${resolved}\n\n` +
            markdown
    };
}
