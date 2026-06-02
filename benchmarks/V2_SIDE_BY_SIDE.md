# OmniCode V2 — Side-by-Side Benchmark

**Engine:** v2 (PageRank import-graph, WRR fusion, file-scoped bounded edge resolution, content-aware scanning, visible blindspots)
**Runtime:** Node v24 (ABI 137), better-sqlite3 native.
**Method:** raw = **estimated** (indexed source bytes ÷ 4). OmniCode cost = **measured** `repo_map` payload (actual characters returned ÷ 4). Savings **capped at 99.9%** unless payload is zero. Raw excludes minified/generated blobs (you wouldn't read those to understand the repo).

> **V2 trades fake-perfect certainty for measured repo understanding.**

## Headline comparison

| Repo | Old Saving | V2 Saving | V2 Parser Coverage | Blindspots | Blocking | Index Time | Verdict |
| --------------- | ---------: | --------: | -----------------: | ---------: | -------: | ---------: | ------- |
| tamagotchi-open | n/a | **99.5%** (measured) | 98.3% | 2 | 1 | 1.5s | clean small-repo baseline — overhead is negligible |
| deer-flow | 98.7% (est) | **99.0%** (measured) | 99.4% | 46 | 42 | 11.4s | measured ≈ old estimate, now with coverage + 46 classified blindspots |
| PURPCLAW | n/a | **99.6%** (measured) | 97.2% | 138 | 87 | 32.1s | indexes a 433-file chaos repo to completion; high blocking count correctly gates repair |
| FORGE DREAM | 99.5% (est) | **99.3%** (measured) | 97.4% | 74 | 6 | 12.0s | measured slightly **below** the old estimate — truer, not louder |

## Full measured fields

| Field | tamagotchi-open | deer-flow | PURPCLAW | FORGE DREAM |
| --- | ---: | ---: | ---: | ---: |
| v2_raw_tokens (est) | 70,831 | 535,235 | 1,124,544 | 648,167 |
| v2_omnicode_tokens (measured) | 358 | 5,310 | 4,929 | 4,714 |
| v2_saving_percent | 99.5 | 99.0 | 99.6 | 99.3 |
| files total | 27 | 441 | 433 | 260 |
| files parsed | 27 | 441 | 433 | 259 |
| parser_coverage % | 98.3 | 99.4 | 97.2 | 97.4 |
| blindspots | 2 | 46 | 138 | 74 |
| blocking blindspots | 1 | 42 | 87 | 6 |
| index_time_ms | 1,512 | 11,377 | 32,057 | 11,977 |
| scan_stop_reason | complete | complete | complete | complete |
| generated_skipped | 0 | 0 | 0 | 0 |
| large_files_skipped | 0 | 0 | 0 | 1 (minified) |
| symbols | 910 | 5,924 | 14,108 | 5,284 |

## Verdict

- **Faster:** ✅ All four indexed to **completion**, none truncated. PURPCLAW (433 files) finished in 32s — under the old O(N²) edge resolver, a repo with duplicated dirs like this would have stalled for minutes (cf. PVX: 360,000ms → 1,551ms after the fix).
- **More honest:** ✅ Savings are **measured payloads**, not formulas; capped at 99.9; raw labeled estimated; coverage reported alongside savings; every skipped file is a visible typed blindspot.
- **More accurate:** ✅ File-scoped, ambiguity-capped edges — no false-edge explosion; 97–99% parser coverage across all four.
- **Safer for repair:** ✅ Blocking blindspots (deer-flow 42, PURPCLAW 87) mean `repair_plan` **refuses destructive edits** on these repos until visibility improves. The governor works.
- **Still token-efficient:** ✅ 99.0–99.6% measured reduction.

**The win is not a bigger headline number.** FORGE DREAM's measured 99.3% is *lower* than its old 99.5% estimate — because the old number was optimistic and the new one is real. V2 knows what it can see, what it can't, and what it's allowed to fix.
