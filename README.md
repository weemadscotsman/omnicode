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
git clone https://github.com/<you>/omnicode.git
cd omnicode
npm install
cd omnicode-mcp && npm install && npm run build && cd ..
```

Then wire it into your client — pick one (`--write` actually merges the config):

```bash
node scripts/install-mcp.mjs claude-code        # prints: claude mcp add … (run it)
node scripts/install-mcp.mjs cursor    --write   # writes .cursor/mcp.json
node scripts/install-mcp.mjs windsurf  --write   # writes ~/.codeium/windsurf/mcp_config.json
node scripts/install-mcp.mjs codex               # prints ~/.codex/config.toml block
node scripts/install-mcp.mjs                      # show config for ALL clients
```

Restart the client. First call should be `index_project`, then explore.

> The installer resolves the absolute path to `omnicode-mcp/dist/server.js` for you and merges into existing config — it never overwrites unrelated entries.

---

## Live status & tokens saved

Every tool call emits a heartbeat to stderr, which your client shows in its MCP server logs — a live "it's working" + savings bar:

```
OmniCode ● active · 142 calls · ~210k tokens saved · last:get_symbol · up 18m
```

Query it anytime via the `runtime_telemetry` tool (calls, errors, tokens returned, tokens saved). Savings are a **conservative, documented estimate** (retrieval payload vs. reading whole files) — it under-counts rather than over-claims.

---

## Tools — compressed MCP surface

To avoid the hidden token tax of a huge tool schema, the **public** surface is small; everything else is reached through a secure gateway:

| Public tool | Purpose |
|---|---|
| `health_check` | prove the server is alive |
| `list_tools` | compact catalog of internal tools (no full schemas) |
| `get_tool_schema` | fetch one internal tool's schema on demand |
| `invoke_tool` | RBAC/sandbox/audit/redaction gateway to internal tools |
| `session_resume_brief` | start a session with compact repo truth (indexed state, health, blindspots, risky/safe files, forbidden actions, exact next action) |

**Internal tools** (via `invoke_tool`): `index_project` · `search_symbols` · `get_symbol` · `get_file_slice` · `get_file_context` · `file_outline` · `repo_map` · `route_map` · `test_map` · `config_map` · `dependency_map` · `blast_radius` · `find_references` · `get_call_hierarchy` · `dead_code_scan` · `blindspot_report` · `blindspot_explorer` · `get_context_bundle` · `get_hotspots` · `get_churn_rate` · `spaghetti_report` · `write_repair_handoff` (alias `repair_plan`) · `check_rename_safe` · `check_delete_safe` · `plan_turn` · `benchmark` · `clone_and_index` · `resolve_all` · `language_support` · `token_savings_stats` · `runtime_telemetry`.

### Highlights
- **Ranked retrieval** — `search_symbols` fuses identity + BM25 lexical + PageRank structural channels (Weighted Reciprocal Rank) with a calibrated confidence score. (A semantic/embedding channel exists but is intentionally **dark** until a real local model lands.)
- **`index_project`** — parallel worker-pool parsing, content-aware skipping (minified blobs skipped, large *authored* files kept, every skip a visible blindspot), partial-index honesty, and **archive ingestion** (`.zip`/`.cbz`/`.epub`/`.jar`, hardened against zip-slip + zip-bomb). Pass `force: true` to re-parse everything after an engine upgrade.
- **`spaghetti_report`** — code health 0–100 (circular deps, god objects, long files, dead code) from the existing index, no re-parse.
- **Repair governor** — `write_repair_handoff` is advisory Markdown only; it **refuses destructive edits** on a partial index or while repo vision is HIGH risk.

---

## Security (real, not slideware)

- **No header-trust auth.** The HTTP surface resolves identity server-side from hashed API keys + HMAC-signed session cookies. Set `OMNICODE_SESSION_SECRET` and `OMNICODE_API_KEYS` (`node scripts/genkey.mjs`).
- **RBAC** — `Admin` / `Developer` / `Read-Only`. The stdio server runs at a configured least-privilege role (`OMNICODE_ROLE`, default `read-only`).
- **Tamper-evident SIEM audit** — hash-chained log; `verifyAuditChain()` detects any alteration/deletion. Secrets redacted before write.
- **Sandbox** — symlink-resolved, all path args checked, optional `OMNICODE_ALLOWED_ROOTS`.

See [`omnicode-mcp/docs/SECURITY.md`](omnicode-mcp/docs/SECURITY.md) and [`STACK_AUDIT.md`](STACK_AUDIT.md).

---

## Config (`.env.local`)

```bash
node scripts/genkey.mjs secret              # → OMNICODE_SESSION_SECRET
node scripts/genkey.mjs key alice Admin     # → an API key + its hashed record
```

See [`.env.example`](.env.example) for all options.

---

## Optional web dashboard

```bash
npm run dev   # http://localhost:3000 — index + symbol search + capsule preview
```

## License

MIT.
