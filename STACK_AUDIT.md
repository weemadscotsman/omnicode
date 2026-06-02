# OmniCode — Full Stack Audit

> **📌 HISTORICAL.** This audit reflects an early state (26 tests, pre-engine-v2). The suite is now
> **137 passing** and the engine has substantially advanced (real PageRank, WRR fusion, worker pool,
> archive ingestion, parser fixes). For current status see [`/CHANGELOG.md`](CHANGELOG.md),
> [`/PARITY_MATRIX.md`](PARITY_MATRIX.md), and [`omnicode-mcp/docs/CLAIMS_AND_LIMITS.md`](omnicode-mcp/docs/CLAIMS_AND_LIMITS.md).
> Kept as a record of the original hardening pass.

Audit of the entire stack after the security hardening + No Spaghett integration.
26/26 runnable logic tests pass (auth, tamper-evident audit, redaction, embeddings,
cosine, spaghetti cycle/god/score heuristics). A full `npm run build` / integration
run requires installing native deps (`better-sqlite3`, `tree-sitter`) on your machine
— that install was intentionally not run here.

## Security (HTTP + MCP) — FIXED
- Server-side identity (hashed API keys + HMAC session cookies); **no `x-role` trust**
  anywhere (verified across all 6 routes).
- Tamper-evident hash-chained audit + redaction on both paths; bounded tail reads.
- MCP role from `OMNICODE_ROLE` (least-privilege default), no longer hardcoded.
- Sandbox: realpath, all path args, optional `OMNICODE_ALLOWED_ROOTS`.
- `/api/download` authenticated; fabricated `confidenceScore` replaced with a derived one.

## Engine correctness — findings

| # | Sev | Where | Finding | Status |
|---|-----|-------|---------|--------|
| 1 | Med | Next dashboard | `lib/goopmunch.ts` builds `data/pilegraph.json`, but the index button calls the **SQLite** `indexProject`. Search/capsule/fossils read pilegraph, which that flow never builds → dashboard search returns "No PileGraph". The **stdio MCP server is unaffected** (it indexes and queries the same SQLite store). | Documented — web-app only |
| 2 | Med | `index_project.ts` + `db.ts` | `call_edges` are keyed by symbol **name**, so `resolveGraphEdges` can cross-link same-named symbols in different files → possible false edges (affects `dependency_map`, `blast_radius`, `spaghetti_report` accuracy). | Known limitation |
| 3 | Low | `index_project.ts` | `goop_score` is never computed in the MCP SQLite path (defaults 0); `search_symbols` still ranks well via fuzzy+embedding fusion, so impact is small. | Note |
| 4 | Low | `get_file_slice.ts` | File lookup uses `path LIKE '%'+filePath` — ambiguous suffix match (returns first of N) and LIKE wildcards in input broaden matches. Not injection (parameterized). | Note |
| 5 | Low | `cli.ts` | `new Date(latest + 'Z')` parses SQLite `YYYY-MM-DD HH:MM:SS` non-standardly (missing `T`). | Cosmetic |
| 6 | Low | `scanner.ts` | No symlink-loop guard during recursive walk. | Note |

## What's solid
- Tree-sitter parser correctly threads the enclosing symbol for call edges; multi-language
  registry degrades gracefully when a grammar isn't installed.
- Incremental indexing via content hash (skips unchanged files); WAL mode; FK cascades.
- `search_symbols` fuses fuzzy (Fuse.js) + cosine over hash-embeddings — robust ranking.
- `get_file_slice` has real token-budgeting (packs top symbols when a slice exceeds budget).
- `spaghetti_report` reuses the existing graph (no re-parse) — clean integration.

## Recommended next (in priority order)
1. **Unify the Next dashboard onto the SQLite store** (or have `indexProject` also emit
   pilegraph) so dashboard search works — fixes finding #1.
2. Key `call_edges` by resolved symbol **id** (or `name@file`) to remove false edges (#2).
3. Compute `goop_score` during indexing (centrality from `edges`) so MCP ranking is full (#3).
