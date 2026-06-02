# Coverage-Complete Benchmark v2

> **📌 Point-in-time record.** Numbers here are from a specific run and are left intact as a
> reproducible record, not re-asserted for the current build. Independently re-verified 4-repo
> side-by-side: [`/benchmarks/V2_SIDE_BY_SIDE.md`](../../benchmarks/V2_SIDE_BY_SIDE.md). Engine
> changes since: [`/CHANGELOG.md`](../../CHANGELOG.md). To refresh, re-run `omnicode sweep` /
> `bench-many` and record the output — figures are never hand-edited here.

**Coverage-complete token savings.** Not "99.9% on the part it managed to see" —
full-repo accounting with **zero unknown files**, while preserving ~99.9% token savings on
large active repos.

Generated from live `omnicode benchmark <repo> --no-write` runs (no-caps full index).

## The claim

> OmniCode delivers full-repo accounting — every discovered file classified, source coverage
> reported, unknown files driven to zero — while preserving ~99.9% token savings, proven from
> 342 files up to 16,925.

## Proof table

| Project | Old indexed¹ | New accounted | Unknown | Source coverage | Raw tokens | Warm query avg² | Saving |
|---|---:|---:|---:|---:|---:|---:|---:|
| CAAL-main | 138 | **342** | **0** | 90.5% | 234K | ~1,536 | **99.9%** |
| BEAST_MARKET_UNIFIED | 344 | **750** | **0** | 95.2% | 1.97M | ~2,716 | **99.9%** |
| PURPCLAW | 433 | **2,261** | **0** | 88.2% | 3.74M | ~2,799 | **99.9%** |
| GOTHAM_3077 | 1,502 *(capped)* | **16,925** | **0** | 95.0% | 18.8M | ~23,941² | **99.9%** |

¹ Old = the capped v1 benchmark (`max_files: 1500`). PURPCLAW and GOTHAM were truncated —
their v1 "savings" were real but silent about the ~80% of files never indexed.
² Warm query average = mean OmniCode payload across repo_map, file_outline, search_symbols,
spaghetti_report. GOTHAM's is inflated by the full-graph spaghetti report (88,388 tokens over a
242,497-edge graph); the queries an agent actually hammers are far smaller — see below.

## What changed: capped v1 → coverage-complete v2

| Aspect | Capped v1 | Coverage-complete v2 |
|---|---|---|
| Scan | stopped at 1,500 files | never stops — walks the whole tree |
| PURPCLAW | 433 indexed of 1,500 capped | **2,261 accounted** |
| GOTHAM_3077 | 1,502 indexed, **partial index** | **16,925 accounted**, full index |
| Unknown / black-hole files | possible (silent raw-read fallback) | **0** across all four repos |
| Coverage reported | no | yes — source coverage + per-state ledger |
| Trust posture | "savings on what it saw" | "everything accounted for, savings intact" |

## GOTHAM_3077 — the stress proof (boss fight)

The repo that v1 hard-truncated at 1,500 files, indexed in full:

- **Files accounted:** 1,502 → **16,925** (≈11× coverage jump)
- **Unknown files: 0** — no black holes at 75 MB / 10,591 source candidates
- **Source coverage:** 95.0%, reported honestly
- **Partial index:** false (`stopReason: null` — nothing truncated)
- **Graph:** 39,886 symbols · 242,497 edges
- **Runtime-required gaps:** 179, each **named** (dynamic refs needing runtime), not called dead
- **Per-query cost:** full repo_map **6,898 tokens** · symbol search **429** · file outline **48**
- **Cumulative:** 81,077,325 → 95,928 tokens = **99.9% saved**

## The number that ends the argument

To give an agent the GOTHAM codebase as raw source is **18.8M tokens** — physically impossible
(~147× a 128K context window). With OmniCode, a full repo map is **6,898 tokens** and a symbol
search is **429**. The repo goes from *"can't even load it"* to *"navigable in a few thousand
tokens, every file accounted for."*

On PURPCLAW the same story: ~3.74M raw tokens vs a **~2,800-token** warm query — roughly
**1,300× fewer tokens per query** — against a repo that is now **100% accounted, 0 unknown**.

## Why this beats "we save tokens"

Rivals: *"We reduce token usage."*
OmniCode: **"We reduce token usage while proving what we did and did not understand for every
file in the repo — file, state, resolver, confidence, and what we refuse to touch."**

That is the leap from benchmark flex to **agent trust layer**: there is no hidden slice where an
agent face-plants into an expensive raw read. Every file has a resolution state.
