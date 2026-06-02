"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spaghettiReport = spaghettiReport;
const db_1 = require("../store/db");
const ocap_1 = require("../engine/ocap");
const DYNAMIC_FOLDERS = ['skills', 'plugins', 'hooks', 'bin', 'scripts', 'tools', 'jobs'];
function isEntryPoint(p) {
    const n = p.replace(/\\/g, '/').toLowerCase();
    return [
        'index',
        'main',
        'layout',
        'page',
        'route',
        '__init__',
        '__main__',
        'server',
        'cli',
        'backend',
        'bridge',
        'worker',
        'service',
        'coordinator',
        'orchestrator',
        'tower',
    ].some((k) => n.includes(k));
}
function isTestOrConfig(p) {
    const n = p.replace(/\\/g, '/').toLowerCase();
    return ['test', 'spec', 'conftest', 'config', 'setup', 'webpack', 'vite', 'package.json'].some((k) => n.includes(k));
}
function inDynamicFolder(p) {
    const n = p.replace(/\\/g, '/').toLowerCase();
    return DYNAMIC_FOLDERS.some((f) => n.includes(`/${f}/`) || n.startsWith(`${f}/`))
        || n.includes('/assets/')
        || n.includes('/public/');
}
async function spaghettiReport(repoPath, godObjectThreshold = 20, longFileThreshold = 500, format = 'auto') {
    const db = (0, db_1.initDb)(repoPath);
    const files = db.prepare(`SELECT path, lines FROM files`).all();
    if (files.length === 0) {
        db.close();
        return { result: `No index found for this repo. Run index_project first.` };
    }
    // Build the file-level dependency graph from symbol call edges plus import
    // edges. Import edges are essential for UI/framework code where files are
    // referenced declaratively rather than through direct function calls.
    const fileEdges = db.prepare(`
    SELECT DISTINCT ff.path AS from_path, tf.path AS to_path
    FROM edges e
    JOIN symbols fs ON e.from_symbol = fs.id
    JOIN symbols ts ON e.to_symbol = ts.id
    JOIN files ff ON fs.file_id = ff.id
    JOIN files tf ON ts.file_id = tf.id
    WHERE ff.path != tf.path
    UNION
    SELECT DISTINCT ff.path AS from_path, tf.path AS to_path
    FROM imports i
    JOIN files ff ON i.from_file_id = ff.id
    JOIN files tf ON i.to_file_id = tf.id
    WHERE ff.path != tf.path
  `).all();
    const nodes = new Set(files.map((f) => f.path));
    const edges = new Map();
    const reverse = new Map();
    for (const p of nodes) {
        edges.set(p, []);
        reverse.set(p, []);
    }
    for (const { from_path, to_path } of fileEdges) {
        if (!nodes.has(from_path) || !nodes.has(to_path))
            continue;
        edges.get(from_path).push(to_path);
        reverse.get(to_path).push(from_path);
    }
    // --- circular dependencies (strongly connected file groups) ---
    const circular = [];
    const indexByNode = new Map();
    const lowByNode = new Map();
    const stack = [];
    const onStack = new Set();
    let nextIndex = 0;
    const strongConnect = (node) => {
        indexByNode.set(node, nextIndex);
        lowByNode.set(node, nextIndex);
        nextIndex++;
        stack.push(node);
        onStack.add(node);
        for (const nb of edges.get(node) || []) {
            if (!indexByNode.has(nb)) {
                strongConnect(nb);
                lowByNode.set(node, Math.min(lowByNode.get(node), lowByNode.get(nb)));
            }
            else if (onStack.has(nb)) {
                lowByNode.set(node, Math.min(lowByNode.get(node), indexByNode.get(nb)));
            }
        }
        if (lowByNode.get(node) === indexByNode.get(node)) {
            const component = [];
            let current;
            do {
                current = stack.pop();
                if (!current)
                    break;
                onStack.delete(current);
                component.push(current);
            } while (current !== node);
            const hasSelfLoop = component.length === 1 && (edges.get(component[0]) || []).includes(component[0]);
            if (component.length > 1 || hasSelfLoop) {
                const representative = component[0];
                circular.push({
                    type: 'Circular Dependency Group',
                    severity: 'high',
                    path: representative,
                    description: `Strongly connected files: ${component.sort().join(' <-> ')}`,
                    suggestion: 'Break the group by extracting shared logic into a neutral module or inverting one dependency.',
                });
            }
        }
    };
    for (const n of nodes)
        if (!indexByNode.has(n))
            strongConnect(n);
    // --- god objects (high incoming fan-in) ---
    const godObjects = [];
    for (const [path, incoming] of reverse.entries()) {
        if (incoming.length > godObjectThreshold) {
            godObjects.push({ type: 'God Object', severity: 'high', path,
                description: `${incoming.length} modules depend on this file.`,
                suggestion: 'Split along responsibilities; expose a smaller, stable interface.' });
        }
    }
    // --- long files ---
    const longFiles = files.filter((f) => (f.lines || 0) > longFileThreshold).map((f) => ({
        type: 'Long File', severity: 'medium', path: f.path,
        description: `${f.lines} lines.`, suggestion: 'Break into cohesive units.'
    }));
    // --- likely dead code (no incoming, not an entry/test/config/dynamic file) ---
    const deadCode = [];
    for (const [path, incoming] of reverse.entries()) {
        if (incoming.length === 0 && !isEntryPoint(path) && !isTestOrConfig(path) && !inDynamicFolder(path)) {
            deadCode.push({ type: 'Dead Code Candidate', severity: 'low', path,
                description: 'No indexed incoming imports/calls and not recognized as an entry point or dynamic module.',
                suggestion: 'Manually verify framework/runtime usage before removing.' });
        }
    }
    // --- score (No Spaghett formula, size-normalized) ---
    const sizeFactor = Math.max(1, nodes.size / 50);
    let score = 100;
    score -= (circular.length * 10) / sizeFactor;
    score -= (godObjects.length * 8) / sizeFactor;
    score -= (longFiles.length * 4) / sizeFactor;
    score -= (deadCode.length * 1) / sizeFactor;
    score = Math.round(Math.max(0, score));
    const totalLines = files.reduce((a, f) => a + (f.lines || 0), 0);
    const grade = score >= 85 ? 'A (clean)' : score >= 70 ? 'B (healthy)' : score >= 50 ? 'C (knotted)' : 'D (spaghetti)';
    // ── Collect every violation as a typed row for OCAP / text path ──
    // Each row: [type, severity, path, count_or_lines, description]
    const typedRows = [];
    for (const v of circular) {
        const match = v.description.match(/:\s*(.+)$/s);
        const tail = match ? match[1] : v.description;
        typedRows.push([v.type, v.severity, v.path, 0, tail.slice(0, 120)]);
    }
    for (const v of godObjects) {
        const match = v.description.match(/^(\d+)/);
        const n = match ? Number(match[1]) : 0;
        typedRows.push([v.type, v.severity, v.path, n, v.description]);
    }
    for (const v of longFiles) {
        const match = v.description.match(/^(\d+)/);
        const n = match ? Number(match[1]) : 0;
        typedRows.push([v.type, v.severity, v.path, n, v.description]);
    }
    for (const v of deadCode) {
        typedRows.push([v.type, v.severity, v.path, 0, v.description.slice(0, 120)]);
    }
    const resolvedFormat = (0, ocap_1.resolveOcapFormat)(format, typedRows.length);
    if (resolvedFormat === 'ocap') {
        const ocap = (0, ocap_1.makeOcapBuilder)('spaghetti_report', ['type', 'severity', 'path', 'count', 'description']);
        for (const [type, severity, p, n, desc] of typedRows) {
            const typeId = ocap.intern('type', type);
            const sevId = ocap.intern('severity', severity);
            const pathId = ocap.intern('path', p);
            ocap.push([typeId, sevId, pathId, n, desc]);
        }
        ocap.setFooter('health', score);
        ocap.setFooter('grade', grade.split(' ')[0]);
        ocap.setFooter('files', nodes.size);
        ocap.setFooter('lines', totalLines);
        ocap.setFooter('circular', circular.length);
        ocap.setFooter('god_objects', godObjects.length);
        ocap.setFooter('long_files', longFiles.length);
        ocap.setFooter('dead_code', deadCode.length);
        db.close();
        return { result: ocap.toText() };
    }
    const section = (title, vs, cap = 15) => vs.length === 0 ? `\n## ${title}: none ✓` :
        `\n## ${title} (${vs.length})\n` + vs.slice(0, cap).map((v) => `  • [${v.severity}] ${v.path}\n    ${v.description}\n    → ${v.suggestion}`).join('\n') +
            (vs.length > cap ? `\n  …and ${vs.length - cap} more` : '');
    const result = `# Spaghetti Report — Health ${score}/100  [${grade}]\n` +
        `Files: ${nodes.size} · Lines: ${totalLines} · Dependency edges: ${fileEdges.length}\n` +
        `Cyclic groups: ${circular.length} · God objects: ${godObjects.length} · Long files: ${longFiles.length} · Dead-code candidates: ${deadCode.length}` +
        section('Cyclic Dependency Groups', circular) +
        section('God Objects', godObjects) +
        section('Long Files', longFiles) +
        section('Dead Code Candidates', deadCode) +
        `\n\n## Handoff\nNo Spaghett does not edit code. To prepare repairs for a separate AI agent or user, call write_repair_handoff. It writes Markdown only and does not apply patches.`;
    db.close();
    return { result };
}
