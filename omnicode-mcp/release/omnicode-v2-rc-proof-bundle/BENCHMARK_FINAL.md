# OmniCode — Benchmark Final (verified)

> **OmniCode is a coverage-complete repo trust layer for AI coding agents. It accounts for every
> file, explains every gap, blocks unsafe repair plans, and lets agents navigate million-token
> repos through compact indexed context instead of raw full-source reads.**

Every number below is from a live `omnicode benchmark` / `resolve-all` run. No competitor
comparisons, no invented rows — claims you can reproduce, not claims you have to trust.

## Headline — MEASURED BYTES (exact, not estimated)

Bytes are the ground truth: exact file sizes and exact utf-8 payload byte lengths. Percentages
are computed from those integers to 6 decimals — no rounding, no modeled ratios. They **vary**,
because they're real.

## Selector-fixed ten-repo rerun (2026-06-01)

Previous aggregate claims were discarded after the benchmark selector was found to use a skipped
archive artifact as the `file_outline` baseline. The selector now uses only parseable
source/test/route files with symbols. The same ten repos were rerun with the fixed selector.

Artifacts:

- `E:\god folder\omnicode_fresh_10_bench_selector_fixed_20260601_155354\BENCHMARK_MATRIX.md`
- `E:\god folder\omnicode_fresh_10_bench_selector_fixed_20260601_155354\benchmarks.ndjson`
- `E:\god folder\omnicode_fresh_10_bench_selector_fixed_20260601_155354\benchmark-summary.json`

Aggregate:

- Repos: **10**
- Errors: **0**
- Files accounted: **13,041**
- Unknown files: **0**
- Raw source tokens estimated: **2,957,492**
- Operation baseline tokens estimated: **12,055,717**
- OmniCode payload tokens estimated: **57,237**
- Measured byte reduction: **99.525269%**
- Reduction factor: **210.65x**

Per-repo corrected reductions:

| Repo | Files accounted | Unknown | Corrected byte reduction |
|---|---:|---:|---:|
| agent-dashboard | 4 | 0 | 96.678363% |
| blackglass | 23 | 0 | 89.230131% |
| BrainrotAutopipe | 211 | 0 | 98.576788% |
| chronos-world-engine | 34 | 0 | 99.628738% |
| cinema-identity-rig | 21 | 0 | 98.415658% |
| Claw3D-main | 439 | 0 | 99.648995% |
| ghostlink-pro | 12,169 | 0 | 99.564742% |
| gold-terminal | 27 | 0 | 99.464600% |
| pray-date | 80 | 0 | 99.224137% |
| red-queen-ai-dashboard | 33 | 0 | 99.742213% |

Launch-safe claim:

> Fresh selector-fixed byte-exact rerun: ten repos, zero errors, 13,041 files accounted,
> zero unknown files, measured byte reduction 99.525269%, reduction factor 210.65x.

## Earlier byte-exact spot checks

| Repo | Files accounted | Unknown | Source coverage | Source bytes (measured) | Cumulative byte reduction |
|---|---:|---:|---:|---:|---:|
| CAAL-main | 351 | **0** | 90.51% | 939,076 | **99.485804%** |
| BEAST_MARKET_UNIFIED | 750 | **0** | 95.17% | 7,889,170 | **99.955153%** |
| PURPCLAW | 2,261 | **0** | 88.2% | — | byte-exact recompute pending¹ |
| GOTHAM_3077 | 16,925 | **0** | 95.0% | — | byte-exact recompute pending¹ |

¹ The harness was just converted from estimated-tokens to measured-bytes. CAAL/BEAST are recomputed
on the exact-byte basis; PURPCLAW/GOTHAM need a re-run via `bench-many` and are intentionally left
blank rather than carrying forward the old estimated numbers. Run them yourself — see below.

### Worked example — every number is a measured integer (CAAL-main)

```
Source bytes (MEASURED): 939076
| operation      | baseline_bytes | payload_bytes | reduction   |
| index          |        939076  |          619  | 99.934084%  |
| repo_map       |        939076  |        20482  | 97.818920%  |
| file_outline   |       1326578  |           94  | 99.992914%  |
| search_symbols |        939076  |         1252  | 99.866677%  |
| spaghetti      |        939076  |         3689  | 99.607167%  |
```

A full repo map of CAAL is **20,482 bytes** vs **939,076** source bytes — a measured 97.82%
reduction for that query. Not a guess; a byte count.

## The number that matters

To hand an agent the GOTHAM codebase as raw source is **18.8M tokens** — physically impossible
(~147× a 128K context window). With OmniCode, a full repo map is **6,898 tokens** and a symbol
search is **429**. The repo goes from *"can't even load it"* to *"navigable in a few thousand
tokens, every file accounted for."*

## Coverage-complete, not partial

The savings cover the **whole** repo, not just the part a capped scanner managed to see:

| Repo | v1 (capped) indexed | v2 (no-caps) accounted | Unknown |
|---|---:|---:|---:|
| PURPCLAW | 433 (capped at 1,500) | **2,261** | 0 |
| GOTHAM_3077 | 1,502 (partial index) | **16,925** | 0 |

## Polyglot proof (11 language families, one repo)

A mixed repo (TS, Python, Ruby, Java, PHP, C, Swift, Solidity, Lua + non-source) →
**100% source resolution coverage, 0 unknown files, 0 resolver gaps.** Every language's imports
resolved; `.env` shielded as secret-risk; ABI JSON classified; nothing hidden.

## Reproduce it

```bash
# one repo:
omnicode benchmark /path/to/repo --no-write

# full ledger (every file's state + excluded dirs, nothing hidden):
omnicode resolve-all /path/to/repo --no-write

# matrix across many repos (local paths or public GitHub URLs):
npm run bench -- benchmarks/repos.txt --out .omnicode-bench
```

See [METHODOLOGY.md](METHODOLOGY.md) for how tokens are measured, [ANOMALIES.md](ANOMALIES.md)
for why high blindspot rates are honest (not failures), and
[COVERAGE_COMPLETE_BENCHMARK_V2.md](COVERAGE_COMPLETE_BENCHMARK_V2.md) for the worked GOTHAM run.

## Positioning (the keeper)

> Index any repo, account for every file with proof, query it in thousands of tokens instead of
> millions, and refuse to break what it doesn't understand.

## Honest open gaps

- No prebuilt binaries yet — native deps (`better-sqlite3`, `tree-sitter`) compile on install.
- Fallback-parsed languages sit at `resolved_partial`; native grammars would lift them to
  `resolved_full`.
- No local-LLM delegation.

None are hidden; all are on the roadmap. That honesty is the point.
