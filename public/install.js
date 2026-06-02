#!/usr/bin/env node
// OmniCode installer.
//
// NOTE: the previous version of this file only *simulated* wiring up clients
// (it printed "Updating … (Simulated)" without changing anything). The real,
// model-agnostic installer now lives at scripts/install-mcp.mjs and emits — and
// optionally writes — correct MCP configuration for Claude Code, Claude Desktop,
// Codex, Cursor, Windsurf, Gemini CLI and Cline/VS Code, pointed at the actual
// built server (omnicode-mcp/dist/server.js).
//
// Usage:
//   node scripts/install-mcp.mjs                  # print config for all clients
//   node scripts/install-mcp.mjs claude-code      # one client
//   node scripts/install-mcp.mjs cursor --write   # actually write/merge it
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const real = path.resolve(here, '..', 'scripts', 'install-mcp.mjs');
const r = spawnSync(process.execPath, [real, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 0);
