#!/usr/bin/env node
// Real, model-agnostic MCP installer for OmniCode.
// Replaces the old simulated install.js. Emits correct, copy-paste configuration
// for every major MCP client, pointed at the actual built server, and can WRITE
// the config for JSON-based clients.
//
//   node scripts/install-mcp.mjs              # print config for all clients
//   node scripts/install-mcp.mjs claude-code  # print one client
//   node scripts/install-mcp.mjs cursor --write   # actually write/merge the config
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..', 'omnicode-mcp', 'dist', 'server.js');
const HOME = os.homedir();
const NAME = 'omnicode';

// The stdio command every client launches. Env carries the MCP-side role.
const serverEntry = {
  command: 'node',
  args: [SERVER],
  env: { OMNICODE_ROLE: 'agent', OMNICODE_USER: 'mcp-client' },
};

// JSON clients: { mcpServers: { omnicode: serverEntry } } merged into a file.
const jsonClients = {
  'claude-desktop': {
    label: 'Claude Desktop',
    file: process.platform === 'win32'
      ? path.join(HOME, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
      : process.platform === 'darwin'
      ? path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : path.join(HOME, '.config', 'Claude', 'claude_desktop_config.json'),
    key: 'mcpServers',
  },
  'cursor': { label: 'Cursor', file: path.join(process.cwd(), '.cursor', 'mcp.json'), key: 'mcpServers' },
  'windsurf': { label: 'Windsurf', file: path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers' },
  'gemini-cli': { label: 'Gemini CLI', file: path.join(HOME, '.gemini', 'settings.json'), key: 'mcpServers' },
  'vscode-mcp': { label: 'VS Code / Cline (project .mcp.json)', file: path.join(process.cwd(), '.mcp.json'), key: 'mcpServers' },
};

function mergeJson(client) {
  const { file, key } = client;
  let data = {};
  if (fs.existsSync(file)) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* start fresh */ }
  }
  data[key] = data[key] || {};
  data[key][NAME] = serverEntry;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function snippet(client) {
  return JSON.stringify({ [client.key]: { [NAME]: serverEntry } }, null, 2);
}

// CLI clients have their own add commands / config formats.
const cliInstructions = {
  'claude-code': () =>
    `Claude Code (CLI) — run:\n  claude mcp add ${NAME} -e OMNICODE_ROLE=agent -- node "${SERVER}"\n` +
    `or add a project .mcp.json (see "vscode-mcp").`,
  'codex': () =>
    `Codex (OpenAI CLI) — add to ~/.codex/config.toml:\n` +
    `  [mcp_servers.${NAME}]\n  command = "node"\n  args = ["${SERVER.replace(/\\/g, '\\\\')}"]\n` +
    `  env = { OMNICODE_ROLE = "agent" }`,
};

const want = process.argv[2];
const doWrite = process.argv.includes('--write');

console.log(`OmniCode MCP server: ${SERVER}`);
if (!fs.existsSync(SERVER)) {
  console.log('⚠  Build it first:  cd omnicode-mcp && npm install && npm run build\n');
}

const targets = want && want !== '--write'
  ? [want]
  : [...Object.keys(cliInstructions), ...Object.keys(jsonClients)];

for (const t of targets) {
  console.log('\n' + '─'.repeat(60));
  if (cliInstructions[t]) {
    console.log(cliInstructions[t]());
  } else if (jsonClients[t]) {
    const c = jsonClients[t];
    console.log(`${c.label} — config file: ${c.file}`);
    if (doWrite) {
      const written = mergeJson(c);
      console.log(`✓ WROTE (merged) ${NAME} into ${written}`);
    } else {
      console.log('Add this (merge into existing):\n' + snippet(c));
    }
  } else {
    console.log(`Unknown client '${t}'. Known: ${[...Object.keys(cliInstructions), ...Object.keys(jsonClients)].join(', ')}`);
  }
}
console.log('\n' + '─'.repeat(60));
console.log('Restart the client after configuring. Tools: index_project, search_symbols, get_symbol, spaghetti_report, blast_radius, …');
