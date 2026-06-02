# Resolution Ledger Spec

The contract behind "Zero Unknown Files": **every discovered file ends in exactly one resolution
state, with proof.** "Skipped" is not a state. Emitted by `omnicode resolve-all` as
`resolution.json` and summarized in `RESOLUTION_REPORT.md`.

## The 8 states

| State | Meaning | Repair posture |
|---|---|---|
| `resolved_full` | Parsed (native grammar), symbols + local imports resolved | full confidence |
| `resolved_partial` | Parsed with caveats (fallback parser / some local imports unresolved / low quality) | guarded |
| `resolved_metadata` | Not code, but classified + recorded (docs, assets, config, empty files) | n/a (not source) |
| `generated_excluded` | Proven generated/minified/vendor artifact | never edit |
| `unsafe_excluded` | Secret/credential-risk — content withheld + logged | never expose |
| `requires_runtime` | Dynamic/runtime references need execution/LSP/ABI to resolve | **no destructive edits** |
| `resolver_missing` | A specific NAMED resolver or native grammar is required | **no destructive edits** |
| `failed_with_reason` | Parse failed; error + next fix recorded | **no destructive edits** |

## Per-file fields

Each file row carries: `path`, `kind`, `state`, `reason`, `resolver_used`, `confidence` (0–1).

## File kinds

`source` · `test` · `config` · `route` · `schema` · `abi_runtime` · `generated` · `asset` ·
`binary` · `docs` · `secret_risk` · `unknown`. The `unknown` count is the metric driven to zero.

## Coverage metrics (reported, not hidden)

- **source_resolution_coverage** = resolved (full+partial) source-like files / source-like files
- **unknown_files** — must be 0
- **unresolved_source_files** — source files needing a named resolver
- **runtime_required_files** — need execution to resolve
- **blocking_repair_gaps** — states that block destructive repair

## Resolver ladder (import binding)

Working import resolvers ship for: **TS/JS, Python, Rust, Go, C#, Ruby, Java/Kotlin, PHP, C/C++,
Swift, Solidity, Lua.** For each language, bare specifiers are external (not gaps); only
unresolvable *local* imports lower confidence. Languages without a resolver produce a **named**
`resolver_missing` (e.g. "needs a native ruby grammar"), never a vague blindspot.

## Repair safety integration

`write_repair_handoff` / `repair_plan` is advisory-only (never edits code) and refuses a
destructive change to any target in `resolver_missing`, `requires_runtime`, `failed_with_reason`,
or `generated` — and to any `ORPHAN_STAGED` / high-intent file — regardless of graph evidence. A
delete/rename must clear BOTH the dependency-graph proof AND the resolution/intent check.

## Output artifacts

`resolve-all` writes: `RESOLUTION_REPORT.md`, `resolution.json`, `unresolved.ndjson`,
`resolver_gaps.md`, `artifact_manifest.json`, `source_coverage.json` — plus a list of every
excluded directory with its reason. Nothing is hidden.
