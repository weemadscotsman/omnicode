# Security Controls

OmniCode MCP is a local stdio MCP server. It indexes source on the machine running the server and
returns bounded tool responses to the connected agent. This package does not ship a public HTTP API
or web dashboard.

## Execution Boundary

- Scanned project code is parsed as text. OmniCode does not execute indexed source files.
- `clone_and_index` only accepts public GitHub HTTPS repository URLs.
- Source does not leave the host through OmniCode except in the specific MCP tool responses the
  agent requested.

## Compressed Tool Surface

Default mode is:

```text
OMNICODE_TOOL_MODE=compressed
```

Compressed mode exposes only:

- `health_check`
- `list_tools`
- `get_tool_schema`
- `invoke_tool`
- `session_resume_brief`

All other tools stay internal and must be called through `invoke_tool`. This reduces schema-token
burn and prevents the agent from loading the whole internal tool surface before it knows what it
needs.

Modes:

| Mode | Behavior |
|---|---|
| `compressed` | five public tools only |
| `full` | direct visibility for all registered tools |
| `debug` | direct visibility for all registered tools, including debug diagnostics |

## RBAC

RBAC is enforced in `src/security/rbac.ts`.

Roles:

- `read-only`
- `agent`
- `admin`

Default role is resolved by the server from environment/config. Read-only users can query and
inspect. Agent users can index, clone public repos, and run safety checks. Admin can call all
registered tools.

`invoke_tool` does not bypass RBAC. It routes internal calls through the same permission checks used
by direct tools. Recursive `invoke_tool` calls are rejected.

## Sandbox

Path arguments are validated in `src/security/sandbox.ts`.

Controls:

- path traversal is rejected
- tool paths must stay inside the authorized repository context
- broad roots such as drive roots and system folders are rejected for indexing
- `OMNICODE_ALLOWED_ROOTS` can restrict which repo roots are allowed
- UNC share handling is lexical for the broad-root guard, so validation does not probe the network

## Archive Ingestion

`index_project` accepts archives (`.zip`/`.cbz`/`.epub`/`.jar`), which are attacker-controllable
input. Extraction in `src/engine/archive_loader.ts` is hardened:

- **Zip-slip** — every entry path is resolved against the temp dir and rejected if it escapes
  (`resolveContainedPath`); absolute and drive-qualified names are refused. yauzl's own
  "invalid relative path" validation is a second layer, and a hostile entry aborts only that
  entry, not the whole ingest.
- **Zip-bomb** — caps are enforced on **uncompressed** size (per-file and total), not compressed
  size, so a small archive that expands enormously is stopped.
- **Streaming** — entries extract one at a time (bounded memory), with `maxFiles`/`maxBytes`/
  `maxScanMs` guards and junk-skip patterns.
- Extraction goes to a per-archive temp dir; the index is keyed by that dir.

## Audit

Tool execution is audited through `src/security/audit.ts`. Audit details are redacted before write.
If repository-local audit storage is unavailable, the fallback log is bounded to the current working
directory and records the failure path clearly.

## Secret Redaction

Redaction is implemented in `src/security/redact.ts` and applied before audit/memory/output spill
paths. Oversized tool output is redacted before it is written to local `.omnicode/artifacts`.

## Project Memory

Project memory is local and append-only:

```text
.omnicode/memory.jsonl
```

Memory events are repo-hash scoped, redacted before write, and intended for small session facts,
decisions, benchmark summaries, handoff records, and repair refusals. It must not store raw source
files or large report bodies.

## Repair Safety

No Spaghett is advisory-only. `spaghetti_report` reports code-health signals. `write_repair_handoff`
and the backward-compatible `repair_plan` alias write Markdown handoff plans only; they do not edit
source code.

Destructive actions are blocked in handoff planning when resolution state, parser quality, runtime
requirements, or other proof gates are not strong enough.
