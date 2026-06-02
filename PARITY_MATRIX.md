# OmniCode vs jcodemunch Parity Matrix

Status key: DONE = implemented and has proof, PARTIAL = implemented with known limits, MISSING = not built yet, BEYOND = planned improvement beyond jcodemunch.

| Capability | OmniCode status | Proof / file | Gap | Beyond target |
|---|---:|---|---|---|
| Safe broad-root rejection | DONE | `tests/broad-root-guard.test.ts`, `assertIndexableRoot()` | None for drive root / UNC share root / system dirs | Add configurable enterprise policy presets. |
| Sandbox path enforcement | DONE | `tests/rbac-sandbox.test.ts`, `enforceSandbox()` | Needs more route-level smoke coverage | Per-tool path policy declarations. |
| Server-side auth and RBAC | DONE | `tests/auth.test.ts`, `tests/rbac-sandbox.test.ts` | No UI session refresh flow tests | Signed operator profiles and per-repo roles. |
| Tamper-evident audit log | DONE | `lib/audit.ts`, audit tests | Needs retention/rotation policy | Exportable SIEM bundle with verifier CLI. |
| Tree-sitter JS/TS indexing | DONE | `tests/mcp-integration.test.ts`, `tests/parser-large-file.test.ts` | Large files (>32KB) now parse via tree-sitter (buffer fix); non-JS/TS depth varies | Lazy grammar packs with install health report. |
| Multi-language grammars | PARTIAL | python/rust/go/c-sharp grammars installed (0.21.x); fallback regex for the rest | Native depth for non-JS/TS is uneven; some languages fallback-only | Unified AST node mapping across grammars. |
| Large-file parsing | DONE | `tests/parser-large-file.test.ts`, parser `bufferSize` fix | None — files over the old 32KB limit now get full AST | Streaming parse for multi-MB authored files. |
| Import graph + path resolution | DONE | `imports` table, `engine/pagerank.ts` resolvers, `tests/pagerank.test.ts` | — tsconfig paths, baseUrl, package exports/imports, `@/` aliases resolved | Cross-repo import graph. |
| PageRank centrality | DONE | `omnicode-mcp/src/engine/pagerank.ts`, `tests/pagerank.test.ts` | Needs dashboard visibility | Per-repo tunable centrality weights. |
| Same-name call edge scoping | DONE | `call_edges.file_id`, integration tests | Needs dedicated false-edge regression | Fully resolved FQN call graph. |
| BM25 lexical retrieval | DONE | `omnicode-mcp/src/retrieval/bm25.ts`, `tests/retrieval.test.ts` | No stemming/synonym expansion | Hybrid BM25 plus code-aware token boosts. |
| WRR signal fusion | DONE | `omnicode-mcp/src/retrieval/signal_fusion.ts`, `omnicode-mcp/scripts/test-semantic-channel.mjs` | Similarity channel is model-gated; active only with provider/model present | Per-repo learned weights. |
| Calibrated confidence | DONE | `omnicode-mcp/src/retrieval/confidence.ts`, `tests/retrieval.test.ts` | — gap/strength/identity/freshness all wired into search | Confidence drives automatic retrieval widening. |
| Real semantic embeddings | DONE | `omnicode-mcp/src/engine/embeddings.ts`, `omnicode-mcp/scripts/test-semantic-channel.mjs`, live MiniLM smoke on OmniCode | Optional local MiniLM works; persistent semantic cache and prebuilt native runtime packaging still needed | Persistent semantic cache and packaged local model. |
| Freshness tracking | DONE | `search_symbols.ts` `isIndexedFileStale`, confidence `freshness` component | Uses mtime-vs-indexed_at; no per-symbol edit tracking yet | Freshness-aware ranking and stale warning. |
| Parallel worker pool | DONE | `engine/parse_pool.ts`, `tests/worker_pool.test.ts` | Embeddings + DB writes remain serial (coordinator) | Adaptive pool sizing + streaming DB batches. |
| Archive ingestion (zip/cbz/epub) | DONE | `engine/archive_loader.ts`, `tests/archive-ingest.test.ts` | No nested archives or tar/gz/7z yet | tar/gz via zlib; 7z via native binary. |
| Large-repo survival | DONE | per-file cap, maxFiles/maxBytes/maxScanMs, partial-index mode, worker pool | Very large monorepos still return partial (honestly reported) | Resumable/streamed indexing across sessions. |
| Force reindex | DONE | `index_project { force: true }` | — | Selective re-parse by changed-parser detection. |
| Compressed MCP schema | DONE | `list_tools`/`get_tool_schema`/`invoke_tool` public surface | — | Per-model tool tiering. |
| Persistent session memory | DONE | `session_resume_brief`, `.omnicode/memory.jsonl` | No cross-repo memory federation yet | Impact prediction from history + churn. |
| Spaghetti report | DONE | `spaghetti_report`, smoke script | Accuracy depends on call/import graph quality | Refactor plan generator and before/after score. |
| Context bundle retrieval | PARTIAL | `get_context_bundle` tool | Needs compression quality benchmark | MUNCH-class schema encoder. |
| Blast radius | PARTIAL | `blast_radius` tool | Needs live diff support | Live blast-radius diff between git states. |
| Dead code scan | PARTIAL | `dead_code_scan` tool | Dynamic entry points can false-positive | Framework-aware entrypoint registry. |
| File outline | DONE | `file_outline` tool | Needs class/member hierarchy richness | Outline with semantic sections and owners. |
| Route/test/config maps | PARTIAL | `route_map`, `test_map`, `config_map` | Needs framework-specific adapters | Unified app topology map. |
| Runtime telemetry | PARTIAL | `runtime_telemetry` tool | Needs dashboard trend history | Per-agent token saved ledger. |
| Smoke harness | DONE | `scripts/smoke-omnicode.mjs` | HTTP dashboard smoke not included yet | One command local + HTTP + MCP client proof. |
| PR risk scoring | MISSING | None | Needs git diff ingestion | Risk score with evidence and suggested reviewers. |
| Layer violation detection | MISSING | None | Needs architecture policy file | Enforced clean architecture contracts. |
| Refactor planning | MISSING | None | Needs graph-aware planner | Safe edit plan with rollback and confidence. |
| Cross-repo graph | MISSING | None | Needs workspace registry | Federation across repo clusters. |

## Current Critical Path

1. **Persistent semantic cache** — keep MiniLM vectors across sessions without mixing them with legacy hash vectors.
2. **MUNCH-class output compression** — cut tokens on the heavy retrieval responses.
3. **Native parser depth** for non-JS/TS languages (grammars installed; node-mapping quality varies).
4. Expand proof harness around ranking quality and dashboard HTTP smoke.
5. Promote only capabilities with tests or smoke evidence to DONE.
