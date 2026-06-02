#!/usr/bin/env node
// OmniDoc MCP — surgical retrieval over Markdown/READMEs/specs.
// Tools: index_docs, get_toc, search_headings, get_section.
// Pulls a specific doc SECTION by id without loading the whole file.
// Pure JS (no native deps). Same stdio MCP protocol as OmniCode.
import fs from 'fs';
import path from 'path';
// SDK is imported lazily inside main() so the pure logic below is unit-testable
// without the MCP SDK installed.

// ── core logic (exported for tests) ──────────────────────────────────────────
export function slugify(s) {
  return s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 80);
}

export function parseMarkdown(rel, content) {
  const lines = content.split('\n');
  const headings = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) headings.push({ level: m[1].length, title: m[2].trim(), line: i, id: `${rel}#${slugify(m[2])}` });
  }
  // section bodies: from a heading to the next heading of <= level
  for (let h = 0; h < headings.length; h++) {
    const start = headings[h].line;
    let end = lines.length;
    for (let k = h + 1; k < headings.length; k++) {
      if (headings[k].level <= headings[h].level) { end = headings[k].line; break; }
    }
    headings[h].body = lines.slice(start, end).join('\n').trim();
  }
  return headings;
}

export function indexDocs(root) {
  const docs = {}; // id -> {file, title, level, body}
  const files = [];
  const walk = (d) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || ['node_modules', 'dist', 'build'].includes(e.name)) continue;
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/\.(md|mdx|markdown)$/i.test(e.name)) files.push(fp);
    }
  };
  walk(root);
  for (const fp of files) {
    const rel = path.relative(root, fp).replace(/\\/g, '/');
    const hs = parseMarkdown(rel, fs.readFileSync(fp, 'utf8'));
    for (const h of hs) docs[h.id] = { file: rel, title: h.title, level: h.level, body: h.body };
  }
  return { docs, fileCount: files.length };
}

let INDEX = { docs: {}, fileCount: 0 };

export function getToc(index = INDEX) {
  return Object.values(index.docs)
    .map((d) => `${'  '.repeat(d.level - 1)}- ${d.title}  [${d.file}]`)
    .join('\n') || '(empty — run index_docs)';
}
export function searchHeadings(q, index = INDEX) {
  const lq = q.toLowerCase();
  return Object.entries(index.docs)
    .filter(([, d]) => d.title.toLowerCase().includes(lq))
    .slice(0, 50)
    .map(([id, d]) => `${d.title}  (id: ${id})`)
    .join('\n') || `No headings match '${q}'.`;
}
export function getSection(id, index = INDEX) {
  const d = index.docs[id];
  return d ? d.body : `Section '${id}' not found. Use search_headings or get_toc for valid ids.`;
}

// ── MCP wiring ────────────────────────────────────────────────────────────────
const TOOLS = [
  { name: 'index_docs', description: 'Index all Markdown under a root path (headings + sections).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'get_toc', description: 'Return the table of contents to orient the agent (no file bodies).',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: [] } },
  { name: 'search_headings', description: 'Search headings across docs; returns matching section ids.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'get_section', description: 'Pull one doc section by id without loading the whole file.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
];

const text = (t) => ({ content: [{ type: 'text', text: t }] });

async function main() {
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const server = new Server({ name: 'omnidoc-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const a = req.params.arguments || {};
    try {
      switch (req.params.name) {
        case 'index_docs': { INDEX = indexDocs(a.path); return text(`Indexed ${Object.keys(INDEX.docs).length} sections from ${INDEX.fileCount} files.`); }
        case 'get_toc': { if (a.path && !INDEX.fileCount) INDEX = indexDocs(a.path); return text(getToc()); }
        case 'search_headings': return text(searchHeadings(a.query));
        case 'get_section': return text(getSection(a.id));
        default: return { ...text(`Unknown tool ${req.params.name}`), isError: true };
      }
    } catch (e) { return { ...text(`Error: ${e.message}`), isError: true }; }
  });
  await server.connect(new StdioServerTransport());
  console.error('OmniDoc MCP running on stdio');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.mjs')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
