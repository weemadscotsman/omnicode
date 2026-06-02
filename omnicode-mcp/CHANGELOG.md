# Changelog

All notable changes to OmniCode. Dates are ISO. Entries describe **verified** changes (tested or live-MCP proof), not aspirations.

## 2026-06-02 - v0.2: Audit trail hardening, god-tier session brief, deprecated alias

### Added
- **Audit trail: args_hash, caller, repo columns** - every `invoke_tool` (and direct) call now records a stable SHA-256 hash of its arguments, the gateway caller (e.g. `invoke_tool`), and the resolved repo path. The audit table is now diffable and queryable by payload signature.
- **`hashAuditArgs` helper** - public, deterministic hash of any tool-input object, exported for tests and audit dashboards.
- **God-tier `session_resume_brief`** - the brief now reports:
  - current git branch, last commit, and 30-day commit count
  - top 5 contributors (last 30 days)
  - detected stack: manifests found, frameworks (from `package.json`), primary language from index
  - language byte breakdown across the index
  - top 10 symbols by importance (PageRank)
  - `brief_version: "v0.2-god-tier"` marker for client-side capability checks
- **Schema migration: audit columns** - existing DBs are upgraded in-place via guarded `ALTER TABLE` (idempotent, no-op on fresh DBs).

### Changed
- **`server.ts` audit wiring** - `executeToolWithSecurity` now takes optional `auditExtras` so `invoke_tool` propagates its caller/repo into the inner tool's audit row. All paths use `hashAuditArgs(args)` to fingerprint payloads.

### Deprecated
- **`repair_plan`** - alias for `write_repair_handoff`. Marked DEPRECATED in v0.2 in `tool_registry.ts`; description and `purpose` field updated. Still works for backward compatibility, will be removed in v0.4.

### Deferred to v0.3
- **Tool result confidence** (parser confidence, fallback-used flag, blindspots-detected, files-excluded) - touches every tool's return shape. Needs design pass.
- **Artifact handoff mode** (repair handoff, file impact report, patch checklist, verification plan) - new feature, multi-day build.

## 2026-06-01 - Byte-exact benchmarks, sweep resilience, trust layer hardening

### Added
- **Byte-exact benchmark harness** - `bench-many` and `sweep` now measure **source bytes** and **payload bytes** directly. No `chars/4` guesses. Percentages are calculated from two measured integers to 6 decimal places. (Previously token estimates were derived from `chars/4` - that's gone.)
- **Resumable indexing** - `index_project` checkpoints after every N files. If a run stops (timeout, disk full, crash), the next compatible run resumes from the saved cursor. `partial_index=1` is set until completion.
- **Archive ingestion (ZIP)** - `index_project` now accepts `.zip`, `.cbz`, `.epub`, `.jar`. Streaming extraction (low memory), hardened against zipslip and zipbomb. Temp dir auto-cleaned (`delete-after-each` policy).
- **Per-file parse timeout** - `OMNICODE_PARSE_TIMEOUT_MS` (default 10s). Hanging worker threads are terminated, the file is recorded as a `PARSE_TIMEOUT` blindspot, and the worker is replaced. The index never stalls.
- **Parallel worker pool** - Tree-sitter parsing fans across `worker_threads`. PVX benchmark: 30s → 18.7s (1.6×). Reads + SQLite writes stay on coordinator.
- **`omnicode init` (first vertical slice)** - Detects Claude Code, writes `claude_desktop_config.json`, injects "use OmniCode first" prompt policy, optional read-guard hook. (More clients to follow.)
- **`audit_agent_config` (beta)** - Scans `CLAUDE.md`, `.cursorrules`, etc. for stale symbols, dead paths, token bloat, unsafe raw-read rules, missing OmniCode policy.
- **Broad-root / UNC share guard** - `assertIndexableRoot()` rejects drive roots, UNC share roots, system dirs.
- **`sweep` cache cleanup** - `--cache-policy delete-after-each` removes index DBs after each repo, kept disk usage under control during 304-project drive sweep.

### Fixed
- **Cross-tool DB path mismatch** - `index_project` normalised paths with `path.resolve()`; read tools used raw input. Now `getDbPath()` hashes `path.resolve(repoPath)` centrally. All tools open the same DB.
- **O(N) graph resolution** - Old name-join exploded on repos with many duplicated symbol names. Rewritten as O(edges) JS resolver. PVX: >360s → 1.55s (230× faster).
- **Parser keyword pollution** - Fallback regex was recording `if(`, `for(`, `return(` as symbols. Added `isValidSymbolName` guard. PVX: 12,308 symbols → 5,288 real symbols; `"if"` as symbol 3,613 → 0.
- **32KB tree-sitter buffer limit** - node-tree-sitter's default parse buffer was 32KB; larger files fell back to regex. Now sized to file length; CLI and server use full AST.
- **Null-byte parse artifact** - Tree-sitter 0.21.1 could inject a spurious null-byte ERROR node. Error detection now flags only real ERROR/MISSING nodes, suppressing the artifact.
- **Batch child timeout** - `bench-many` and `sweep` used to hang on huge repos (GOTHAM). Added `--repo-timeout-ms` (default 15 min). Stuck child is killed and recorded as timeout failure, not opaque crash.

### Changed
- **tree-sitter grammars aligned to core** - `tree-sitter-typescript` and `tree-sitter-javascript` downgraded 0.23→0.21 to match `tree-sitter` 0.21.1 and other grammars (Python, Rust, Go, C#). No parsing regression.

### Deprecated (planned)
- The old `tokenEstimate` derived from `chars/4` is gone from benchmark output. Tokens now only appear as a clearly labeled `bytes/4` estimate - never the headline.

### Tests
- Suite grew to **137 passing**. New tests: worker pool, resumable index, archive ingestion (containment / bomb / e2e), parser keyword filter, large-file parse, null-byte suppression, PageRank/resolvers, DB path identity, benchmark child timeout.

### Honest non-goals (still open)
- Real semantic embeddings - infrastructure added (ONNX MiniLM path), but model not yet packaged. Similarity channel is dark unless user installs model manually.
- MUNCH-class output compression - OCAP spec written, implementation pending.
- Native parser depth for non-JS/TS - grammars installed, but node-mapping quality varies.
