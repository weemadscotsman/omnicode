# OmniCode

**The AI-agent repo operating layer: a model-agnostic MCP server that lets any coding agent understand, navigate, and *safely* work a codebase without burning context on full-file reads or hallucinated architecture.**

Indexes your repo into a real symbol + import/call graph (Tree-sitter + PageRank), then serves exact symbols, ranked search, call graphs, blast-radius, code-health, and a session brief over the standard Model Context Protocol — so the agent stops `cat`-ing whole files and burning your tokens. It also **governs repair**: it refuses destructive edits until its own view of the repo is clean enough.

Works natively with **Claude Code, Claude Desktop, Codex, Cursor, Windsurf, Gemini CLI, Cline** and any MCP client (stdio).

Three jobs, better than a plain repo mapper:

1. **Token firewall** — stop agents re-reading whole repos.
2. **Repo understanding** — a real multi-layer graph (imports, calls, manifests, resolvers), not just symbols.
3. **Repair governor** — turn findings into safe, proof-gated handoffs before anything edits code.

---

## Install (clean, ~1 min)

```bash
git clone https://github.com/weemadscotsman/omnicode.git
cd omnicode
npm install
cd omnicode-mcp && npm install && npm run build && cd ..
```

Then wire it into your client — pick one (`--write` actually merges into your existing config; the rest just print the snippet):

```bash
node scripts/install-mcp.mjs claude-code        # prints: claude mcp add … (run it)
node scripts/install-mcp.mjs cursor    --write   # writes .cursor/mcp.json
node scripts/install-mcp.mjs windsurf  --write   # writes ~/.codeium/windsurf/mcp_config.json
node scripts/install-mcp.mjs codex               # prints ~/.codex/config.toml block
node scripts/install-mcp.mjs                      # show config for ALL clients
```

> The installer resolves the absolute path to `omnicode-mcp/dist/server.js` and merges into existing config — it never overwrites unrelated entries. If you ran `omnicode-mcp && npm run build` already, the dist path will exist; if not, the installer prints a warning and still emits the config (build it before restarting the client).
>
> Supported clients: `claude-code`, `codex`, `claude-desktop`, `cursor`, `windsurf`, `gemini-cli`, `vscode-mcp` (project `.mcp.json`).

Restart the client. First call should be `session_resume_brief`, then `index_project`.

---

## Live status & tokens saved

Every tool call emits a heartbeat to stderr, which your client shows in its MCP server logs — a live "it's working" + savings bar:

```
OmniCode ● active · 142 calls · ~210k tokens saved · last:get_symbol · up 18m
```

Query it anytime via the `runtime_telemetry` tool (calls, errors, tokens returned, tokens saved). Savings are a **conservative, documented estimate** (retrieval payload vs. reading whole files) — it under-counts rather than over-claims. See [omnicode-mcp/docs/TOKEN_SAVINGS.md](omnicode-mcp/docs/TOKEN_SAVINGS.md).

---

## Tools — compressed MCP surface

The server runs as a **stdio MCP server** (no HTTP surface). To avoid the hidden token tax of a huge tool schema, the public surface is gated by `OMNICODE_TOOL_MODE`:

| Mode | What's directly visible to the agent |
|---|---|
| `compressed` (default) | 5 public tools — everything else is reached through `invoke_tool` |
| `full` | all 30+ registered tools, including `skill_search` / `skill_load` / `skill_pack_for_task` |
| `debug` | `full` + debug diagnostics |

### Compressed (default) public surface

| Public tool | Purpose |
|---|---|
| `health_check` | prove the server is alive |
| `list_tools` | compact catalog of internal tools (no full schemas) |
| `get_tool_schema` | fetch one internal tool's schema on demand |
| `invoke_tool` | RBAC/sandbox/audit/redaction gateway to internal tools |
| `session_resume_brief` | start a session with compact repo truth (indexed state, health, blindspots, risky/safe files, forbidden actions, exact next action) |

### Internal tools (always reachable via `invoke_tool`)

`index_project` · `search_symbols` · `get_symbol` · `get_file_slice` · `get_file_context` · `file_outline` · `repo_map` · `route_map` · `test_map` · `config_map` · `dependency_map` · `blast_radius` · `find_references` · `get_call_hierarchy` · `dead_code_scan` · `blindspot_report` · `blindspot_explorer` · `get_context_bundle` · `get_hotspots` · `get_churn_rate` · `spaghetti_report` · `write_repair_handoff` (alias `repair_plan`) · `check_rename_safe` · `check_delete_safe` · `plan_turn` · `benchmark` · `clone_and_index` · `resolve_all` · `language_support` · `token_savings_stats` · `runtime_telemetry` · `audit_agent_config`.

### Full-mode extras (only visible when `OMNICODE_TOOL_MODE=full`)

`skill_search` · `skill_load` · `skill_pack_for_task`.

### Highlights

- **Ranked retrieval** — `search_symbols` fuses identity + BM25 lexical + PageRank structural channels (Weighted Reciprocal Rank) with a calibrated confidence score. A semantic/embedding channel exists but is intentionally **dark** until a real local model lands; toggle with `OMNICODE_DISABLE_SEMANTIC_EMBEDDINGS=0`.
- **`index_project`** — parallel worker-pool parsing, content-aware skipping (minified blobs skipped, large *authored* files kept, every skip a visible blindspot), partial-index honesty, and **archive ingestion** (`.zip`/`.cbz`/`.epub`/`.jar`, hardened against zip-slip and zip-bomb). Pass `force: true` to re-parse everything after an engine upgrade. Guards: `OMNICODE_MAX_FILES` (default 20,000), `OMNICODE_MAX_BYTES` (default 250 MB), `OMNICODE_MAX_SCAN_MS` (default 10 min), `OMNICODE_MAX_FILE_BYTES` (default 512 KB per file).
- **`spaghetti_report`** — code health 0–100 (circular deps, god objects, long files, dead code) from the existing index, no re-parse.
- **Repair governor** — `write_repair_handoff` is advisory Markdown only; it **refuses destructive edits** on a partial index or while repo vision is HIGH risk.
- **Output budget** — `OMNICODE_OUTPUT_MODE` (default `active`), `OMNICODE_MAX_RESPONSE_TOKENS` (default 8,000), `OMNICODE_SUMMARY_TOKENS` (default 1,200). Active mode streams the hot path; non-active mode summarizes.

See [omnicode-mcp/README.md](omnicode-mcp/README.md) for the full server doc and [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for the operator playbook.

---

## Security (real, not slideware)

The server is **stdio** — it inherits the host's user permissions. Trust lives in the design, not the transport.

- **RBAC** — three roles: `read-only` (inspect), `agent` (default; can index, clone public repos, run safety checks), `admin` (full tool surface). `invoke_tool` does NOT bypass RBAC — recursive `invoke_tool` calls are rejected. Set the role per client via `OMNICODE_ROLE` in the launch env. The bundled `install-mcp.mjs` injects `OMNICODE_ROLE=agent` and `OMNICODE_USER=mcp-client` by default.
- **Sandbox** — path arguments are validated in `src/security/sandbox.ts`. Path traversal is rejected; tool paths must stay inside the authorized repository context; drive roots and system folders are rejected for indexing. Restrict further with `OMNICODE_ALLOWED_ROOTS` (semicolon-separated, e.g. `C:/code;E:/projects`).
- **Archive ingestion** — zip-slip rejected (resolved entry must stay inside temp dir; absolute and drive-qualified names refused), zip-bomb guarded (caps on **uncompressed** size, not compressed), streaming extraction with the same `OMNICODE_MAX_*` guards.
- **Tamper-evident audit** — every `invoke_tool` call records caller, repo path, args SHA-256 hash, and tool outcome in a hash-chained SQLite table; `verifyAuditChain()` detects any alteration/deletion. Secrets are redacted (`src/security/redact.ts`) before write.
- **Project memory is local, append-only, redacted** — `.omnicode/memory.jsonl`, repo-hash-scoped, intended for small session facts only (no raw source, no large report bodies).
- **No HTTP surface** — there is no OmniCode HTTP API or web dashboard in this repo. (`npm run dev` runs the bundled Next.js admin UI, which is the only HTTP piece.)

See [omnicode-mcp/docs/SECURITY.md](omnicode-mcp/docs/SECURITY.md) and [STACK_AUDIT.md](STACK_AUDIT.md) for the full security posture.

---

## Config (env vars)

All env vars are read directly by the server — no `.env` file is required. The bundled `install-mcp.mjs` already wires `OMNICODE_ROLE` and `OMNICODE_USER` into the client launch env.

| Var | Default | What it does |
|---|---|---|
| `OMNICODE_ROLE` | `agent` (via install-mcp) | `read-only` / `agent` / `admin` — gates `invoke_tool` |
| `OMNICODE_USER` | `mcp-client` (via install-mcp) | recorded in the audit table |
| `OMNICODE_TOOL_MODE` | `compressed` | `compressed` / `full` / `debug` — controls direct tool visibility |
| `OMNICODE_ALLOWED_ROOTS` | (any) | semicolon-separated list; empty = any path inside an indexed repo |
| `OMNICODE_MAX_FILES` | `20000` | archive/index file-count cap |
| `OMNICODE_MAX_BYTES` | `268435456` (250 MB) | total uncompressed index byte cap |
| `OMNICODE_MAX_SCAN_MS` | `600000` (10 min) | scan time cap |
| `OMNICODE_MAX_FILE_BYTES` | `524288` (512 KB) | per-file cap before skipping to blindspot |
| `OMNICODE_PARSE_TIMEOUT_MS` | `10000` | per-file parse timeout |
| `OMNICODE_INDEX_MAX_FILES_PER_RUN` | `0` (unlimited) | optional run-level cap |
| `OMNICODE_OUTPUT_MODE` | `active` | `active` streams, `summarize` keeps payloads small |
| `OMNICODE_MAX_RESPONSE_TOKENS` | `8000` | response budget per tool call |
| `OMNICODE_SUMMARY_TOKENS` | `1200` | summary budget when `output_mode=summarize` |
| `OMNICODE_ARTIFACT_BASE` | `.omnicode/artifacts` | where oversized tool output is spilled |
| `OMNICODE_DB_DIR` | `~/.omnicode` (CLI) / repo-local (server) | SQLite location |
| `OMNICODE_WATCHER_MAX_FILES` | `5000` | chokidar file-watch cap |
| `OMNICODE_DISABLE_SEMANTIC_EMBEDDINGS` | `0` | set to `1` to skip embedding work (faster, less rich retrieval) |
| `OMNICODE_EMBEDDING_MODEL_DIR` | (auto) | where to find the local MiniLM model |
| `OMNICODE_SIMILARITY_CANDIDATE_LIMIT` | `2500` | cap on BM25/Pagerank candidates |
| `OMNICODE_PROJECT_ROOT` | (auto) | override the project root for engine config |
| `OMNICODE_IGNORE_PATTERNS` | (built-in defaults) | extra ignore globs (semicolon-separated) |
| `OMNICODE_BENCH_CHILD_PATH` | (bundled) | override the bench child process entry |

> **Note on `node scripts/genkey.mjs`:** that script exists in the tree and emits a session secret + hashed API-key records. It is wired for the planned HTTP surface (a future control-plane). The current stdio server inherits the host's user; it does not read `OMNICODE_SESSION_SECRET` or `OMNICODE_API_KEYS` yet. When the HTTP surface lands, those env vars become the auth layer.

---

## Optional web admin UI

`npm run dev` boots the Next.js admin UI bundled in `app/` (port 3000) — index viewer, symbol search, and a capsule preview. The web UI talks to the same `omnicode-mcp` server over stdio; it does not embed a second MCP server.

```bash
npm run dev   # http://localhost:3000
```

---

## License

MIT.
