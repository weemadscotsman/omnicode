"use strict";
// ───────────────────────────────────────────────────────────────────────────
// OCAP — OmniCode Compact Access Protocol (v1)
//
// A row-oriented, deduplicated text serialization designed to drop the
// token cost of OmniCode outputs without changing the underlying data.
// Three things make it cheap:
//   1. Path interning: every unique file path appears exactly once in a
//      shared table. The same long Windows path used 30 times now costs
//      ~30 bytes instead of 30 × full-path.
//   2. Fixed-key row format: every row is a tab-separated tuple whose
//      position is defined by `k`. The agent parses one schema and
//      streams rows.
//   3. Stable enums: low-cardinality fields (kind, lang, severity) are
//      enumerated as 0/1/2 with a parallel `intern` table.
//
// v1 wire format (UTF-8 text, stable across versions):
//   First non-empty line: `OCAP v1`
//   Second line: `t: <tool_name>`
//   Third line: `k: <comma-separated column keys>`
//   Then any number of `intern: <bucket> <id>=<value> ...` lines
//   Then `---` separator
//   Then one row per line, tab-separated values matching `k` order
//   Optional `##` comment lines for footer/metadata
//
// Example (search_symbols):
//   OCAP v1
//   t: search_symbols
//   k: name,kind,path,line,score
//   intern kind: 0=function 1=method 2=class
//   intern path: 0=src/repo_map.ts 1=src/search_symbols.ts
//   ---
//   repoMap    \t0\t0\t4  \t0.95
//   searchSyms \t0\t1\t50 \t0.87
//   ## confidence=87 car=on
//
// `format=auto` (the default) picks OCAP whenever the input has a
// `path` argument and the payload is row-shaped (>= 4 rows). Otherwise
// it returns plain text. Callers can force `format=text` to keep
// human-readable output regardless of size.
// ───────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeOcapBuilder = makeOcapBuilder;
exports.shouldUseOcap = shouldUseOcap;
exports.resolveOcapFormat = resolveOcapFormat;
const HEADER_PREFIX = 'OCAP v1';
const SEPARATOR = '---';
const INTERN_PREFIX = 'intern';
const FOOTER_PREFIX = '##';
function internBucket(name) {
    return { name, values: [], index: new Map() };
}
function makeOcapBuilder(tool, keys) {
    const payload = {
        tool,
        keys,
        buckets: [],
        rows: [],
        footer: undefined,
    };
    const bucketByName = new Map();
    const intern = (bucket, value) => {
        let b = bucketByName.get(bucket);
        if (!b) {
            b = internBucket(bucket);
            bucketByName.set(bucket, b);
            payload.buckets.push(b);
        }
        const hit = b.index.get(value);
        if (hit !== undefined)
            return hit;
        const id = b.values.length;
        b.values.push(value);
        b.index.set(value, id);
        return id;
    };
    const push = (row) => {
        payload.rows.push(row);
    };
    const setFooter = (key, value) => {
        if (!payload.footer)
            payload.footer = {};
        payload.footer[key] = value;
    };
    const toText = (_opts) => {
        const out = [];
        out.push(HEADER_PREFIX);
        out.push(`t: ${tool}`);
        out.push(`k: ${keys.join(',')}`);
        for (const b of payload.buckets) {
            const entries = b.values.map((v, i) => `${i}=${v}`).join(' ');
            out.push(`${INTERN_PREFIX} ${b.name}: ${entries}`);
        }
        out.push(SEPARATOR);
        for (const row of payload.rows) {
            out.push(row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))).join('\t'));
        }
        if (payload.footer) {
            const footerEntries = Object.entries(payload.footer)
                .map(([k, v]) => `${k}=${v === null || v === undefined ? '' : String(v)}`)
                .join(' ');
            if (footerEntries)
                out.push(`${FOOTER_PREFIX} ${footerEntries}`);
        }
        return out.join('\n');
    };
    return { payload, intern, push, setFooter, toText };
}
function shouldUseOcap(format, rowCount) {
    if (format === 'ocap')
        return true;
    if (format === 'text')
        return false;
    // auto: prefer OCAP when there are enough rows to make the
    // interning + header overhead worth it. Threshold tuned so the
    // smallest realistic query (4 hits) still flips to OCAP.
    return rowCount >= 4;
}
function resolveOcapFormat(format, rowCount) {
    return shouldUseOcap(format, rowCount) ? 'ocap' : 'text';
}
