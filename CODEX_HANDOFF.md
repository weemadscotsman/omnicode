# OmniCode — Codex Handoff (continue here)

> Written by Claude at the end of a long build session, for Codex to pick up cold.
> Everything here is **verified state** unless marked TODO. Read the **Environment**
> section first — it will save you the pain we already paid.

---

## 0. Environment — READ THIS FIRST (hard-won)

- **Node version matters (ABI).** `better-sqlite3` + tree-sitter grammars are native.
  This repo's native binaries are built for **Node v24 (ABI 137)** at:
  `C:\Users\Admin\AppData\Local\nvm\v24.14.0\node.exe`
  - Run tests + scripts with **that exact node**, not the Program Files v22:
    `& "C:\Users\Admin\AppData\Local\nvm\v24.14.0\node.exe" node_modules/vitest/vitest.mjs run`
  - The Claude Desktop app spawns the MCP server via `claude_desktop_config.json`
    (`C:\Users\Admin\AppData\Roaming\Claude\`), pinned to that v24 node. Keep them aligned.
  - If you change a native dep, **whoever rebuilds decides the ABI for everyone.** Don't
    drift `better-sqlite3` / tree-sitter to a node the app isn't using.
- **tree-sitter grammars are pinned to 0.21.x** to match `tree-sitter` core 0.21.1
  (typescript/javascript were downgraded 0.23→0.21 this session). Do NOT bump them
  without bumping core too.
- **Hot-reload the live MCP server** = kill the process, the app auto-respawns with fresh `dist`:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -like '*omnicode*server.js*' } | % { Stop-Process -Id $_.ProcessId -Force }`
  Then call any tool to trigger respawn. **No app restart needed for code changes** (only for
  config/command changes).
- **NEVER delete a repo's `~/.omnicode/<hash>.db` while the live server has it open** — it
  crashes the server (we did this twice). Use `index_project { force: true }` to re-parse instead.
- **Build:** `cd omnicode-mcp && npm run build` (tsc). **Force reindex:** `index_project { path, force: true }`.
- Test baseline: `npm test` passes, including trust, resolver, benchmark selector,
  resumable index, DB path identity, child timeout, and semantic-channel coverage.

---

## 1. Current verified state (what's live)

- **Compressed MCP surface:** public = `health_check`, `list_tools`, `get_tool_schema`,
  `invoke_tool`, `session_resume_brief`. Everything else is internal via `invoke_tool`.
- **Retrieval:** WRR fusion (identity + BM25 + optional semantic similarity + PageRank)
  + calibrated confidence. `search_symbols` now lights the `similarity` channel only
  when a real provider/model is available; otherwise it falls back cleanly to
  identity+BM25+PageRank.
- **Engine fixes shipped this session** (see `CHANGELOG.md`): worker pool, archive ingestion
  (zip), per-file content-aware cap, broad-root/UNC guard, partial-index honesty + repair refusal,
  O(N²) graph fix, parser keyword guard, 32KB buffer fix, null-byte artifact suppression, grammar
  alignment, `force` flag.
- **Memory:** `session_resume_brief` + `.omnicode/memory.jsonl`. Repair governor refuses
  destructive edits on partial index / HIGH risk.
- **DB path identity:** `store/db.ts#getDbPath()` hashes `path.resolve(repoPath)`.
  Keep this central. It prevents `E:/...` vs `E:\...` from creating separate DBs
  between `index_project` and read tools.
- **Batch child timeout:** `bench-many`, `bench-drive`, and `sweep` have
  `--repo-timeout-ms` (default 15 minutes). Stuck benchmark children are killed,
  recorded as timeout failures, and do not stall the whole sweep.
- **Docs:** fully reconciled this session (CHANGELOG + READMEs + PARITY_MATRIX + guides). Historical
  docs are bannered, not rewritten. Don't fabricate benchmark numbers — re-run `sweep`/`bench-many`.

---

## 2. Roadmap — build in THIS order

### TIER 1 (highest leverage)

**T1.1 — Per-file parse timeout** `[STATUS: LANDED — see §3]`
- A pathological/huge file can hang a worker. Add `OMNICODE_PARSE_TIMEOUT_MS` (default ~10s).
- Where: `engine/parse_pool.ts` (worker-side watchdog) + `engine/scanner.ts` already has byte cap.
- Acceptance: a synthetic file that makes tree-sitter spin is abandoned with a typed blindspot
  (`PARSE_TIMEOUT`), index continues, test proves it.

**T1.2 — Streaming / resumable indexing for monorepos** `[STATUS: LANDED — see §3]`
- Scanner already full-walks with no global max-file stop; T1.2 landed as durable indexing
  checkpoints around the existing chunk-safe write loop.
- Where: `tools/index_project.ts` stores `index_resume_*` metadata in `index_meta`, keyed to the
  scanned file-list fingerprint.
- Acceptance: `scripts/test-resumable-index.mjs` forces a two-file checkpoint, resumes the same
  repo, and verifies completion with `partial_index=0`.

**T1.3 — Real local embeddings (lights up similarity channel)** `[STATUS: LANDED — packaging/cache remain]`
- DONE: `engine/embeddings.ts` has a pluggable semantic provider and optional
  `onnxruntime-node` + `tokenizers` MiniLM loader. `search_symbols` wires the real
  `similarity` channel into WRR and includes semantic hits in the candidate pool.
- DONE: graceful fallback when deps/model files are absent; hash embeddings are kept only
  as legacy index vectors and are not treated as semantic evidence.
- DONE: `scripts/download-embedding-model.mjs` downloads `all-MiniLM-L6-v2`
  `model.onnx` + `tokenizer.json`; live smoke produced a real 384-dimensional
  vector and `search_symbols` against OmniCode reported
  `channels: identity+lexical+similarity+structural`.
- TODO: add persistent semantic cache separate from legacy `symbol_embeddings` and
  harden install/prebuild packaging for native runtimes.

**T1.4 — Prebuilt native binaries / pinned runtime**
- Eliminate the ABI roulette. Ship platform prebuilds or move grammars to N-API; document/pin Node.

### TIER 2 (accuracy & efficiency)
- **T2.1 FQN-resolved call graph** — edges are name-based + ambiguity-capped today. Precise refs.
- **T2.2 MUNCH-class output compression** — path interning + schema packing on `get_context_bundle`,
  `repo_map`. ~45% byte cut compounding per call.
- **T2.3 Native parser depth** for non-JS/TS (grammars installed; node-mapping quality varies).

### TIER 3 (capability surface — still MISSING in PARITY_MATRIX)
- PR risk scoring (git diff → risk + evidence)
- Layer-violation detection
- Refactor planning (graph-aware safe edit plan)
- `search_ast` (anti-pattern presets)
- Impact prediction ("last time this file changed, these tests broke" — memory has the data)
- **Intent-loop hookup:** `recordFileTouch` exists + is tested but is NOT called from session
  tools yet (see BLINDSPOT_CLASSIFICATION_SPEC §7). One-line emit points in
  `assemble_task_context` / edit paths.

---

## 3. Completed Tier-1 status

**Per-file parse timeout is DONE and verified.** `engine/parse_pool.ts`:
- `OMNICODE_PARSE_TIMEOUT_MS` (default 10000, floor 1000). Per-job `setTimeout` armed in `pump()`,
  cleared in `onMessage`/`onWorkerError`/`destroy`.
- On timeout: terminate the worker, **resolve the file with a `PARSE_TIMEOUT` blindspot** (NOT a
  sync fallback — that would hang the main thread on the same file), and `spawnWorker()` to keep
  the pool at size. Refactored worker creation into `spawnWorker()`.
- Build clean; **137/137 tests pass**; worker_pool + archive tests green (refactor didn't regress
  determinism).

**T1.1 TODO (small):** add a *deterministic* hang-fixture test. parseSource is too fast to
time out naturally, and the timeout floor is 1000ms, so this needs either a test-only env override
to drop the floor, or a worker that can be told to sleep. Nice-to-have — the path is implemented
and reviewed, just not covered by a dedicated test.

**T1.2 — Resumable indexing is DONE and verified.** `tools/index_project.ts`:
- `resume` defaults on unless `force` is used.
- `maxIndexFilesPerRun` / `OMNICODE_INDEX_MAX_FILES_PER_RUN` can intentionally stop a run after
  N source candidates, persist `index_resume_state=in_progress`, and mark
  `scan_stop_reason=index_incomplete`.
- The next compatible run resumes from `index_resume_cursor`; when complete, it stores
  `index_resume_state=complete`, `partial_index=0`, and `scan_stop_reason=complete`.
- Verified with `npm run build`, `npm run test:resumable-index`, and full `npm test`.

---

## (resume here) Next: T1.3b persistent semantic cache, then T1.4 prebuilt native runtime.

---

## 4. Operational gotchas (don't repeat our mistakes)
- Don't nuke a live DB (§0). Use `force`.
- Run tests/scripts with the v24 node (§0).
- After native dep changes: kill omnicode servers to release `.node` locks before reinstalling.
- Keep `tests` green (137+). Add a test with every fix.
- Be honest in docs: no invented benchmark numbers; banner historical docs, don't rewrite them.
