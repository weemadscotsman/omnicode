# V2 Benchmark — Anomalies & Look-Closer Items

Flagged automatically where a row deviates from the clean baseline. None are failures; all are *honesty signals*.

## 1. PURPCLAW — slowest index (32.1s) + highest blocking blindspots (87)
- 433 files, 14,108 symbols — the largest symbol count in the set, and a chaotic real project.
- 32s is well within budget (scan_stop_reason = complete) but ~3× the others. Worth profiling for the worker-pool work (Priority 2) since this is the realistic "messy repo" case.
- 87 of 138 blindspots are blocking (63%). This is **correct behavior**, not a bug: `repair_plan` will refuse destructive edits here until imports/aliases resolve. A chaotic repo *should* read as high-risk.

## 2. deer-flow — 91% of blindspots are blocking (42 / 46)
- High blocking ratio suggests many unresolved imports/aliases or dynamic dispatch (likely Python + mixed module roots).
- Action: this is the resolver's next target — improving Python/relative-import resolution would convert blocking blindspots into resolved edges and *lower* the risk gate honestly.

## 3. FORGE DREAM — measured savings (99.3%) BELOW old estimate (99.5%)
- Not a regression. The old 99.5% was a path-based estimate; 99.3% is the measured `repo_map` payload. The gap is the estimate's optimism, now corrected.
- 1 file skipped as `minified` (recorded as a visible blindspot, not dropped silently).

## 4. tamagotchi-open — 1 of 2 blindspots blocking on a tiny repo
- Expected: a small repo still has at least one unresolved/dynamic reference. Low absolute count, no concern. Confirms overhead does not wreck tiny projects (1.5s, 99.5%).

## Cross-cutting
- **All four: scan_stop_reason = complete.** No timeouts, no max_files/max_bytes truncation. Large-repo guards were not even triggered at this size class — the next stress tier (COMFY-scale, 20k+ files) is where partial-index + worker pool must prove out.
- **generated_skipped = 0 across all four** — none of these repos carry `.next`/`dist`/`build` source inside the scanned set (they're correctly excluded at the directory level before counting).
- **Old numbers exist for only 2 of 4 repos** (deer-flow, FORGE DREAM), both *estimated*. tamagotchi-open and PURPCLAW have no recorded old measurement — not fabricated to fill the table.
