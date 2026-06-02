# Changelog

All notable engine and tooling changes. Dates are ISO. Entries describe what was
built **and verified** (test or live-MCP proof), not aspirations.

## 2026-06-01 — Scale, accuracy, and ingestion pass

### Added
- **Model-gated semantic retrieval channel** (`engine/embeddings.ts`,
  `tools/search_symbols.ts`). `search_symbols` can now add a real `similarity`
  WRR channel when a semantic embedding provider is available. The legacy
  `symbol_embeddings` hash vectors are not treated as semantic evidence. Local
  ONNX MiniLM support is optional and disables cleanly when `onnxruntime-node`,
  `tokenizers`, or model files are absent.
  - Verified: `scripts/test-semantic-channel.mjs` injects a deterministic
    provider and proves semantic-only query `"database connection pooling"`
    ranks `SqlConnWorker`; the same test proves missing-model fallback keeps
    search working with the similarity channel dark.
  - Verified live: downloaded `all-MiniLM-L6-v2` `model.onnx` + `tokenizer.json`,
    installed `onnxruntime-node` plus the Windows `tokenizers` runtime, produced
    a real 384-dimensional embedding, and ran `search_symbols` against OmniCode
    itself with `channels: identity+lexical+similarity+structural`.
- **Parallel worker pool for indexing** (`engine/parse_pool.ts`, `engine/parse_worker.ts`).
  tree-sitter parsing now fans across `worker_threads` (default `min(cpu-1, 8)`);
  reads and **all** SQLite writes stay on the coordinator, so workers never touch
  the DB. Workers share the parent Node runtime, so the native parser ABI always
  matches. Graceful sync fallback on any worker failure.
  - Verified: PVX (681 files) 30,001ms → 18,745ms (1.60×), **deterministic** —
    parallel and sync produce the identical 5,288 symbols.
- **Archive ingestion** (`engine/archive_loader.ts`). `index_project` now accepts
  `.zip` / `.cbz` / `.epub` / `.jar`: streamed extraction (one entry at a time,
  low memory) → temp dir → normal index. Hardened against:
  - **zip-slip** — `resolveContainedPath` rejects traversal/absolute/drive entry
    names; yauzl's own validation is a second layer.
  - **zip-bomb** — caps on **uncompressed** size (per-file and total), not compressed.
  - junk-skip (`.git`/`node_modules`/`.min`/`.map`) + `maxFiles`/`maxBytes`/`maxScanMs`.
  - Verified end-to-end on a real 6MB deflate zip and 7 unit tests.
- **`force` reindex flag** on `index_project` — re-parse every file even if
  unchanged (use after a parser/engine upgrade). Schema + handler + function.
- **Per-file parse timeout** (`engine/parse_pool.ts`, `OMNICODE_PARSE_TIMEOUT_MS`,
  default 10s). A worker that hangs on a pathological file is terminated, the file
  is recorded as a `PARSE_TIMEOUT` blindspot (no sync fallback — that would hang
  the main thread), and a replacement worker is spawned. The index never stalls.
- **Resumable indexing checkpoints** (`tools/index_project.ts`). Long index runs now
  persist `index_resume_*` metadata keyed to the scanned file-list fingerprint. If a
  run stops before all source candidates are written, downstream tools see
  `partial_index=1` and `scan_stop_reason=index_incomplete`; the next compatible run
  resumes from the saved cursor and clears the partial state when complete.
  - Verified: `scripts/test-resumable-index.mjs` forces a two-file checkpoint, resumes
    the same repo, and confirms five files complete with `partial_index=0`.
- **Per-file byte cap with content-aware classification** (`engine/scanner.ts`).
  Over-cap files are classified: genuinely **minified** blobs are skipped (their
  symbols are noise), **large authored** source is still indexed (coverage over
  speed), and **every** skip is recorded as a visible, typed blindspot.
- **Broad-root guard** (`security/sandbox.ts` `assertIndexableRoot`). Refuses to
  index drive roots, UNC share roots, and system/home dirs. UNC-aware: a
  share-child (`\\server\share\repo`) indexes; the bare share is rejected.
- **Partial-index honesty.** A scan that hits any guard is marked `partialIndex`
  and persisted to `index_meta`; `repair_plan` **refuses destructive edits on a
  partial index** ("good enough to navigate, not to delete").

### Fixed
- **Cross-tool DB path mismatch** (`store/db.ts`). `index_project` normalized repo
  paths before DB hashing, while read tools could open a different DB when called
  with slash variants like `E:/...` versus `E:\...`. `getDbPath()` now hashes
  `path.resolve(repoPath)` centrally so `index_project`, `session_resume_brief`,
  `repo_map`, and `search_symbols` all open the same index.
  - Verified through live compressed MCP calls on five `E:\god folder\02_ACTIVE_PROJECTS`
    repos: index, resume brief, repo map, and symbol search.
  - Regression-covered by `scripts/test-db-path-identity.mjs`.
- **Batch benchmark child timeout** (`cli.ts`). `bench-many`, `bench-drive`, and
  `sweep` now accept `--repo-timeout-ms` with a 15-minute default. A stuck child
  is killed and recorded as a clear timeout failure instead of burning an hour and
  returning an opaque Windows exit code. Child stdout/stderr buffers are bounded.
  - Regression-covered by `scripts/test-benchmark-child-timeout.mjs`.
- **O(N²) graph-resolution blowup** (`store/db.ts` `resolveGraphEdges`). The old
  name-join detonated on repos with duplicated/common symbol names. Rewritten as
  bounded O(edges) JS resolution: file-scoped first, ambiguity-capped global
  fallback, junk-name filtered. PVX: **>360,000ms → 1,551ms** (~230×). Also more
  accurate — an ambiguous call name creates zero edges instead of N false ones.
- **Parser keyword pollution** (`engine/parser.ts`). A broad fallback regex was
  recording every `if (`, `for (`, `return (` as a "method" symbol. Added a
  central `isValidSymbolName` reserved-word guard at every push point (fallback,
  tree-sitter, call edges) and dropped the noisy fallback `method` merge on the
  tree-sitter path. PVX: 12,308 → **5,288 real symbols**; `"if"` as a symbol
  3,613 → **0**.
- **32KB tree-sitter buffer limit** (`engine/parser.ts`). node-tree-sitter's parse
  buffer defaults to 32KB; any larger file threw "Invalid argument" and silently
  degraded to regex fallback. Now sized to the file. `cli.ts`/`server.ts` went
  from regex-fallback (quality ~0.6) to full tree-sitter (1.0 / 0.97).
- **Null-byte parse artifact** (`engine/parser.ts`). node-tree-sitter core 0.21.1
  can inject a spurious null-byte ERROR node (a U+0000) mid-parse on a valid file. Error
  detection now flags only actual ERROR/MISSING nodes (was recursive `hasError()`)
  and suppresses null-byte artifacts — while still catching genuine syntax errors.
  `pagerank.ts` quality 0.6 → **1.0**, 5 false parse errors → 0.

### Changed
- **tree-sitter grammars aligned to the core.** `tree-sitter-typescript` and
  `tree-sitter-javascript` moved 0.23.x → 0.21.x to match `tree-sitter` 0.21.1 and
  the other grammars (python/rust/go/c#). No parsing regression (137 tests pass).

### Tests
- Suite grew to **137 passing**. New: worker pool + partial-index + repair refusal,
  archive ingestion (containment / bomb / e2e), scanner guards, parser keyword,
  large-file parsing, null-byte suppression, PageRank/resolvers.

### Honest non-goals still open
- Persistent semantic embedding cache separate from the legacy hash-vector
  `symbol_embeddings` table.
- Prebuilt native/runtime packaging for `onnxruntime-node`, `tokenizers`, and
  tree-sitter/better-sqlite3 so users do not hit local ABI/build friction.
- MUNCH-class output compression.
- Native parser **depth** for non-JS/TS (grammars installed; quality varies).
