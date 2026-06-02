#!/usr/bin/env node
// OmniData MCP — precise answers from data files (CSV today).
// Tools: describe_dataset, aggregate (GROUP BY), join (server-side JOIN),
// data_hotspots (null rates + numeric correlations). Pure JS, no native deps.
import fs from 'fs';
// SDK imported lazily inside main() so the pure logic is unit-testable standalone.

// ── CSV + analysis (exported for tests) ───────────────────────────────────────
export function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); field = ''; row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
export function loadCsv(file) { return parseCsv(fs.readFileSync(file, 'utf8')); }

const isNum = (v) => v !== '' && v != null && !isNaN(Number(v));
export function inferType(values) {
  const nonEmpty = values.filter((v) => v !== '' && v != null);
  if (nonEmpty.length && nonEmpty.every(isNum)) return 'number';
  if (nonEmpty.length && nonEmpty.every((v) => /^(true|false)$/i.test(v))) return 'boolean';
  if (nonEmpty.length && nonEmpty.every((v) => !isNaN(Date.parse(v)))) return 'date';
  return 'string';
}

export function describe(rows) {
  if (!rows.length) return { rows: 0, columns: [] };
  const cols = Object.keys(rows[0]);
  const columns = cols.map((c) => {
    const vals = rows.map((r) => r[c]);
    const nonEmpty = vals.filter((v) => v !== '' && v != null);
    const type = inferType(vals);
    const col = { name: c, type, nulls: vals.length - nonEmpty.length, distinct: new Set(nonEmpty).size };
    if (type === 'number') {
      const nums = nonEmpty.map(Number);
      col.min = Math.min(...nums); col.max = Math.max(...nums);
      col.mean = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000;
    }
    return col;
  });
  return { rows: rows.length, columns };
}

export function aggregate(rows, groupBy, metric, op) {
  const groups = new Map();
  for (const r of rows) {
    const k = r[groupBy];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const [k, rs] of groups) {
    const nums = rs.map((r) => Number(r[metric])).filter((n) => !isNaN(n));
    let val;
    switch (op) {
      case 'count': val = rs.length; break;
      case 'sum': val = nums.reduce((a, b) => a + b, 0); break;
      case 'avg': val = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; break;
      case 'min': val = Math.min(...nums); break;
      case 'max': val = Math.max(...nums); break;
      default: val = rs.length;
    }
    out.push({ [groupBy]: k, [`${op}_${metric}`]: Math.round(val * 1000) / 1000 });
  }
  return out.sort((a, b) => Object.values(b)[1] - Object.values(a)[1]);
}

export function innerJoin(left, right, leftKey, rightKey) {
  const idx = new Map();
  for (const r of right) { const k = r[rightKey]; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(r); }
  const out = [];
  for (const l of left) for (const r of (idx.get(l[leftKey]) || [])) out.push({ ...r, ...l });
  return out;
}

export function pearson(xs, ys) {
  const n = xs.length; if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? Math.round((num / Math.sqrt(dx * dy)) * 1000) / 1000 : 0;
}

export function hotspots(rows) {
  const d = describe(rows);
  const nullIssues = d.columns.filter((c) => c.nulls > 0).map((c) => `  • ${c.name}: ${c.nulls}/${d.rows} null (${Math.round(100 * c.nulls / d.rows)}%)`);
  const constants = d.columns.filter((c) => c.distinct <= 1 && d.rows > 1).map((c) => `  • ${c.name}: constant/empty`);
  const numCols = d.columns.filter((c) => c.type === 'number').map((c) => c.name);
  const corrs = [];
  for (let i = 0; i < numCols.length; i++) for (let j = i + 1; j < numCols.length; j++) {
    const xs = rows.map((r) => Number(r[numCols[i]])), ys = rows.map((r) => Number(r[numCols[j]]));
    const ok = xs.map((x, k) => [x, ys[k]]).filter(([a, b]) => !isNaN(a) && !isNaN(b));
    const c = pearson(ok.map((p) => p[0]), ok.map((p) => p[1]));
    if (Math.abs(c) >= 0.5) corrs.push(`  • ${numCols[i]} ↔ ${numCols[j]}: r=${c}`);
  }
  return `Data-quality hotspots (${d.rows} rows):\n` +
    `Null gaps:\n${nullIssues.join('\n') || '  none'}\n` +
    `Constant columns:\n${constants.join('\n') || '  none'}\n` +
    `Strong correlations (|r|≥0.5):\n${corrs.join('\n') || '  none'}`;
}

// ── MCP wiring ────────────────────────────────────────────────────────────────
const TOOLS = [
  { name: 'describe_dataset', description: 'Row count, columns, inferred types, null counts, ranges — without dumping the data.',
    inputSchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] } },
  { name: 'aggregate', description: 'Server-side GROUP BY aggregation (count/sum/avg/min/max).',
    inputSchema: { type: 'object', properties: { file: { type: 'string' }, group_by: { type: 'string' }, metric: { type: 'string' }, op: { type: 'string' } }, required: ['file', 'group_by', 'op'] } },
  { name: 'join', description: 'Server-side inner JOIN of two CSVs on keys; returns describe() of the result.',
    inputSchema: { type: 'object', properties: { left: { type: 'string' }, right: { type: 'string' }, left_key: { type: 'string' }, right_key: { type: 'string' } }, required: ['left', 'right', 'left_key', 'right_key'] } },
  { name: 'data_hotspots', description: 'Null gaps, constant columns, and strong numeric correlations in one call.',
    inputSchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] } },
];
const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });

async function main() {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const server = new Server({ name: 'omnidata-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const a = req.params.arguments || {};
    try {
      switch (req.params.name) {
        case 'describe_dataset': return text(describe(loadCsv(a.file)));
        case 'aggregate': return text(aggregate(loadCsv(a.file), a.group_by, a.metric || a.group_by, a.op));
        case 'join': return text({ joined: 'ok', ...describe(innerJoin(loadCsv(a.left), loadCsv(a.right), a.left_key, a.right_key)) });
        case 'data_hotspots': return text(hotspots(loadCsv(a.file)));
        default: return { ...text(`Unknown tool ${req.params.name}`), isError: true };
      }
    } catch (e) { return { ...text(`Error: ${e.message}`), isError: true }; }
  });
  await server.connect(new StdioServerTransport());
  console.error('OmniData MCP running on stdio');
}
if (process.argv[1]?.endsWith('server.mjs')) main().catch((e) => { console.error(e); process.exit(1); });
