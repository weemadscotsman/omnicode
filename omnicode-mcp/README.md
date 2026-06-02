# OmniCode MCP

**Coverage-complete code intelligence for AI agents.** OmniCode indexes any repository into a
queryable symbol graph so your agent navigates a codebase in *thousands* of tokens instead of
millions — while accounting for **every file**, with **zero silent skips**.

It's a standard [Model Context Protocol](https://modelcontextprotocol.io) server (stdio), so it
plugs into Claude Desktop, Claude Code, Cursor, Codex, Cline, and any MCP client.

## v0.2 highlights

- **God-tier `session_resume_brief`** - one call tells the agent: current git branch, recent
  churn, top contributors, detected stack, top 10 symbols by importance, and an honest risk
  grade. Every agent should call this first.
- **Audit trail hardening** - every `invoke_tool` (and direct) call now records its caller
  (`invoke_tool`), repo path, and a stable SHA-256 hash of its arguments. Diff the audit table
  by payload signature to spot anomalous agent behavior.
- **Layered, public-only MCP surface** - 8 public tools (`list_tools`, `get_tool_schema`,
  `invoke_tool`, `session_resume_brief`, `health_check`, `skill_search`, `skill_load`,
  `skill_pack_for_task`). The other 33 live behind `invoke_tool` with RBAC. Read-only by
  default. No tool bloat in the LLM's context.
- **Web page**: <https://weemadscotsman.github.io/omnicode-mcp/> (landing) — installation,
  benchmark proof, and the 41-tool surface at a glance.

See [CHANGELOG.md](CHANGELOG.md) for the full list of v0.2 changes.

## Why it's different

Most token-savers are great "on the part they managed to see." OmniCode is built so the savings
cover the repo **honestly** — and so it survives the repos that show up wearing boots:

- **Scale, with honesty** — parallel worker-pool parsing handles large repos; guards
  (`maxFiles` / `maxBytes` / `maxScanMs` + a per-file cap) keep a monster repo from melting the
  machine. If a guard trips, the index is marked **partial** and *says so* — it is never reported
  as complete.
- **Zero Unknown Files** — every discovered file ends in one of 8 *proven* resolution states
  (`resolved_full`, `resolved_partial`, `resolved_metadata`, `generated_excluded`,
  `unsafe_excluded`, `requires_runtime`, `resolver_missing`, `failed_with_reason`).
- **No silent skips** — excluded dirs (`node_modules`, `.git`, build caches), minified blobs, and
  oversized files are all *recorded with reasons* as typed blindspots. Large **authored** source is
  always indexed; only genuinely generated/minified content is skipped.
- **11 language resolvers** — TS/JS, Python, Rust, Go, C#, Ruby, Java/Kotlin, PHP, C/C++, Swift,
  Solidity, Lua (JS/TS native; others vary in depth). Each unresolved case is a **named**
  requirement, never a vague blindspot.
- **Archive ingestion** — point `index` at a `.zip`/`.cbz`/`.epub`/`.jar`; it streams, extracts,
  and indexes (hardened against zip-slip and zip-bomb).
- **Trust layer** — RBAC, sandboxing, audit, secret redaction, and a repair governor that
  refuses destructive edits on a partial index or a repo it doesn't yet understand well enough.

Measured on real repos: ~**99%+** token savings (e.g. a multi-million-token repo's map in a few
thousand tokens), with **0 unknown files**. Savings are reported as *measured* payload vs.
*estimated* raw — never rounded to 100% unless the payload is literally zero.

## Install (one command)

```bash
git clone <repo-url> && cd omnicode-mcp
npm install          # builds automatically (prepare), compiles native deps
```

That's it — `npm install` pulls `better-sqlite3` + `tree-sitter` and builds `dist/`. Requires
Node ≥ 18 and a C toolchain for the native deps (Xcode CLT / build-essential / VS Build Tools).

Optionally expose the `omnicode` CLI globally:

```bash
npm link
omnicode --help
```

## Connect it to your agent

Generate a paste-ready config for your client:

```bash
omnicode mcp-config --client claude        # Claude Desktop
omnicode mcp-config --client claude-code    # prints the `claude mcp add ...` command
omnicode mcp-config --client cursor         # ~/.cursor/mcp.json
omnicode mcp-config --client codex          # ~/.codex/config.toml
```

Example (Claude Desktop / Cursor shape):

```json
{
  "mcpServers": {
    "omnicode": {
      "command": "/path/to/node",
      "args": ["/path/to/omnicode-mcp/dist/server.js"]
    }
  }
}
```

## CLI commands

| Command | What it does |
|---|---|
| `omnicode index [repo]` | Index/refresh a repo (parallel worker pool; guards + partial-index honesty; accepts a `.zip`/`.cbz`/`.epub`/`.jar`) |
| `omnicode resolve-all [repo]` | Zero-Unknown-Files ledger + reports (states, coverage, excluded dirs) |
| `omnicode blindspots [repo] --explain` | Explain blindspots + top unresolved references, honestly |
| `omnicode benchmark [repo]` | Token-savings + resolution coverage for one repo |
| `omnicode bench-many <list>` | Reproducible benchmark matrix across many repos |
| `omnicode status [repo]` | Index freshness, completeness, sleeping symbols |
| `omnicode clean [repo]` | Reclaim disk — delete regenerable index caches |
| `omnicode mcp-config` | Print MCP config for your client |

## Reproduce the benchmark

The benchmark is a first-class command, not a side script:

```bash
# 1. List repos (local paths or public GitHub HTTPS URLs), one per line:
cp benchmarks/repos.example.txt benchmarks/repos.txt   # then edit

# 2. Run it — writes a matrix + per-repo JSON:
npm run bench -- benchmarks/repos.txt --out .omnicode-bench
```

Output: `BENCHMARK_MATRIX.md`, `benchmarks.ndjson`, and `benchmark-summary.json` — raw tokens,
files accounted, source coverage, unknown count, and cumulative savings per repo. Each repo runs
in an isolated child process. See [docs/COVERAGE_COMPLETE_BENCHMARK_V2.md](docs/COVERAGE_COMPLETE_BENCHMARK_V2.md)
for a worked example.

## How it works (briefly)

Tree-sitter (with regex fallback for languages without a loaded grammar) extracts symbols,
imports, and call edges into a SQLite graph — parsing runs across a **worker-thread pool**, with
all DB writes on a single coordinator. Per-language resolvers bind imports to files; real
**PageRank** over the import graph ranks importance. `search_symbols` fuses identity + BM25 +
PageRank channels (Weighted Reciprocal Rank) with a calibrated confidence score. Query tools
(`repo_map`, `search_symbols`, `get_context_bundle`, …) return tiny, ranked payloads instead of
raw source. The public MCP surface is **compressed** (`list_tools` / `get_tool_schema` /
`invoke_tool`) to avoid tool-schema token bloat.

## Proof pack
- [Benchmark Final](docs/BENCHMARK_FINAL.md) — verified headline numbers + reproduction commands
- [Coverage-Complete Benchmark v2](docs/COVERAGE_COMPLETE_BENCHMARK_V2.md) — the worked GOTHAM run
- [Methodology](docs/METHODOLOGY.md) — how tokens are measured, with limitations
- [Anomalies](docs/ANOMALIES.md) — why high blindspot rates are honest, not failures
- [Resolution Ledger Spec](docs/RESOLUTION_LEDGER_SPEC.md) — the 8-state contract

## Docs
- [Architecture](docs/ARCHITECTURE.md)
- [User Guide](docs/USER_GUIDE.md)

## License
MIT
