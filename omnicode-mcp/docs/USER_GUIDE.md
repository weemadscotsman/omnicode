# OmniCode User Guide

OmniCode is a local MCP server for AI coding agents. It indexes a repository into a queryable code
graph so the agent can ask for compact repo state, symbols, outlines, dependency context, and safety
reports instead of brute-reading whole files.

## Install From This Checkout

```bash
npm install
npm run build
node dist/cli.js doctor
```

Optional local CLI install:

```bash
npm link
omnicode doctor
```

## Add To An MCP Client

Print a ready-to-copy MCP server config:

```bash
omnicode mcp-config
```

The server entrypoint is:

```text
dist/server.js
```

Default tool mode is compressed:

```text
OMNICODE_TOOL_MODE=compressed
```

In compressed mode the agent sees only five public tools:

- `health_check`
- `list_tools`
- `get_tool_schema`
- `invoke_tool`
- `session_resume_brief`

## First Call In A New Session

Start with:

```json
{
  "tool": "session_resume_brief",
  "input": {
    "path": "C:/path/to/repo"
  }
}
```

The brief returns compact repo truth:

- repo identity
- last indexed state
- parser coverage
- blindspots and blocking gaps
- safe/risky files
- latest handoff path
- recent project memory
- exact next action
- forbidden actions
- recommended next OmniCode tool

## Load One Hidden Tool Schema

```json
{
  "tool": "get_tool_schema",
  "input": {
    "tool_name": "benchmark"
  }
}
```

`get_tool_schema` returns exactly one schema, subject to RBAC.

## Invoke An Internal Tool

```json
{
  "tool": "invoke_tool",
  "input": {
    "tool_name": "benchmark",
    "tool_input": {
      "path": "C:/path/to/repo",
      "write": true
    }
  }
}
```

`invoke_tool` still passes through RBAC, sandbox checks, audit, redaction, argument validation, and
safe error handling.

## Useful CLI Commands

| Command | Purpose |
|---|---|
| `omnicode doctor` | Check local runtime, build output, native dependencies, and Git availability |
| `omnicode status [repo]` | Show indexed repo status |
| `omnicode resume <repo>` | Print `session_resume_brief` from the CLI |
| `omnicode index <repo>` | Index a local repo or a `.zip`/`.cbz`/`.epub`/`.jar` archive (parallel worker pool; `--force` re-parses everything after an engine upgrade) |
| `omnicode resolve-all <repo>` | Write or print the Zero Unknown Files resolution ledger |
| `omnicode blindspots <repo>` | Explain parser/visibility blindspots |
| `omnicode context <repo> <file>` | Get a file plus direct internal dependencies |
| `omnicode token-stats <repo>` | Show token/output-budget stats |
| `omnicode benchmark <repo>` | Run byte-exact benchmark for one repo |
| `omnicode bench-many <repos.txt>` | Run a byte-exact matrix over local paths or public GitHub URLs |
| `omnicode sweep <root>` | Discover and benchmark many local project folders one-by-one with cache cleanup |
| `omnicode clone-index <github-url>` | Shallow clone a public GitHub repo and index it |

## Common Internal Tools

Use through `invoke_tool` in compressed mode.

| Tool | Purpose | Required input |
|---|---|---|
| `index_project` | index/refresh a repo or archive (`path` may be a dir or `.zip`/`.cbz`/`.epub`/`.jar`); optional `force: true`, `no_watch: true`, `max_files`/`max_bytes`/`max_scan_ms` guards | `path` |
| `repo_map` | high-level repo structure | `path` |
| `file_outline` | symbols in one file | `path`, `file_path` |
| `search_symbols` | ranked symbol search | `path`, `query` |
| `get_symbol` | exact symbol snippet | `path`, `symbol_name` |
| `get_file_slice` | bounded line range | `path`, `file_path`, `start_line`, `end_line` |
| `get_file_context` | requested file plus direct internal dependencies | `path`, `file_path` |
| `dependency_map` | dependency graph for one symbol | `path`, `symbol_name` |
| `blast_radius` | dependent impact map | `path`, `symbol_name` |
| `spaghetti_report` | advisory code-health report | `path` |
| `write_repair_handoff` | Markdown repair handoff only | `path` |
| `resolve_all` | full resolution ledger | `path` |
| `benchmark` | byte-exact token/byte proof | `path` |

## No Spaghett Rule

`spaghetti_report` does not repair code. `write_repair_handoff` writes Markdown only, defaulting to:

```text
.omnicode/NO_SPAGHETT_REPAIR_HANDOFF.md
```

That handoff is for a human or another agent to review. OmniCode itself does not mutate source code.

## Benchmark Rule

Public claims should use measured byte results, not guessed token ratios. See:

- `docs/METHODOLOGY.md`
- `docs/BENCHMARK_FINAL.md`
- `docs/ANOMALIES.md`

## Full Drive Sweep

Use `sweep` when you need to audit hundreds of local project folders without keeping every index
cache alive.

Dry run first:

```bash
omnicode sweep "E:/god folder" --dry-run --out "E:/god folder/omnicode_sweep_dryrun"
```

Small live test:

```bash
omnicode sweep "E:/god folder" --out "E:/god folder/omnicode_sweep_test" --max-projects 5 --cache-policy delete-after-each
```

Full resumable run:

```bash
omnicode sweep "E:/god folder" --out "E:/god folder/omnicode_sweep_full" --cache-policy delete-after-each --min-free-gb 10 --resume
```

Sweep writes:

- `SWEEP_MATRIX.md`
- `sweep-results.ndjson`
- `sweep-summary.json`
- `sweep-errors.md`
- `sweep-anomalies.md`
- `sweep-empty-folders.md`
- `sweep-not-projects.md`
- `sweep-disk-log.ndjson`
- `sweep-resume.json`

Default cache policy is `delete-after-each`, so each repo is benchmarked, recorded, and then its
OmniCode DB cache is removed before the next repo.
