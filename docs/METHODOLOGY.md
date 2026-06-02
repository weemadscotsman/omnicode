# Benchmark Methodology

How OmniCode measures token savings — stated plainly so the numbers are auditable, not magic.

## What is measured — BYTES, exactly. No guessing.

The ground truth is **bytes**, because bytes are exact, reproducible, and model-agnostic.
Tokens are model-specific, so any single token number is an estimate — we never headline one.

- **baseline_bytes** = exact source size. For whole-repo operations, the measured sum of indexed
  file sizes; for `file_outline`, the measured byte size of the file. MEASURED.
- **payload_bytes** = `Buffer.byteLength(toolResponse, 'utf-8')` — the exact byte size of what the
  tool actually returns. MEASURED.
- **reduction_percent** = `(baseline_bytes − payload_bytes) / baseline_bytes` — exact, computed
  from the two measured integers, reported to 6 decimals (no rounding to a flat "99.9%").
- **tokens** = `bytes ÷ 4`, reported only as a clearly-labeled `*_tokens_estimated` field. Never
  the headline, never presented as measured.

Every operation row is `measurement: exact_bytes` and `measurement_type:
measured_payload_bytes_vs_measured_source_bytes`. **There are no modeled baselines** — the old
`0.7×raw` spaghetti heuristic was removed; its baseline is now the measured source bytes.

## Operations benchmarked

`index`, `repo_map`, `file_outline`, `search_symbols`, `spaghetti_report`. The `warm query
average` is the mean payload across the non-index operations — what an agent pays per repeated
query once the index exists.

## Source-outline selection policy

`file_outline` is a source-understanding benchmark, not an artifact-compression trick.

- Eligible files: parseable `source`, `test`, or `route` files.
- Eligible states: `resolved_full` or `resolved_partial`.
- The file must have symbols and a parser mode other than `none`, `skipped`, or `unknown`.
- Excluded: generated files, unsafe files, metadata-only files, docs, assets, binaries, archives,
  minified bundles, and skipped artifacts.
- Excluded extensions include `.zip`, `.tar`, `.gz`, `.rar`, `.7z`, `.mp4`, `.mp3`, `.png`,
  `.jpg`, `.jpeg`, `.webp`, `.exe`, `.dll`, and `.bin`.
- If no eligible file exists, `file_outline` is marked `skipped` with
  `file_outline_skipped:no_parseable_source_file`.
- Skipped operations contribute zero baseline and zero payload to cumulative totals.
- If the largest repo file is a skipped artifact, the benchmark reports
  `largest_file_skipped_artifact:<path>:<bytes>`.

This policy was added after a real benchmark run found that `ghostlink-pro.zip` was correctly
classified as a skipped artifact, but the old `file_outline` selector still used it as the largest
file baseline. That inflated the aggregate reduction factor. The inflated aggregate was discarded,
the selector was patched, and the same ten repos were rerun.

## No modeled numbers (full disclosure)

Every baseline is a measured byte count (file sizes). The previous `spaghetti_report` heuristic
(`0.7 × raw`) was **removed** — its baseline is now the measured source bytes like every other
operation. There are **no modeled ratios anywhere** in the output.

Percentages are shown to 6 decimals (`99.934084%`, `97.818920%`) — never floored to a flat
`99.9%` — so real per-repo and per-operation variance is visible. Identical numbers everywhere
would be a red flag; these vary because they're computed from exact measured bytes.

## Example (measured, CAAL-main)

```
Source bytes (MEASURED): 939076
index           939076 →    619 bytes = 99.934084%
repo_map        939076 →  20482 bytes = 97.818920%
file_outline   1326578 →     94 bytes = 99.992914%
search_symbols  939076 →   1252 bytes = 99.866677%
spaghetti       939076 →   3689 bytes = 99.607167%
Cumulative     5082882 →  26136 bytes = 99.485804% reduction
```

## Indexing conditions

- **Bounded guards + honest partial-index.** The scanner has safety guards
  (`maxFiles`/`maxBytes`/`maxScanMs` + a per-file cap) and a parallel worker pool for throughput.
  If a guard trips, the index is marked `partial_index: true` (with `scan_stop_reason`) — it is
  never reported as complete, and `repair_plan` refuses destructive edits on a partial index. A
  guard-free run reports `partial_index: false`, `scan_stop_reason: complete`.
- **Excluded directories are reported,** not silent: `node_modules`, `.git`, build/caches are
  skipped by design and listed in `resolve-all` with reasons. Real project dot-dirs (`.github`,
  `.vscode`) ARE indexed.
- **Every discovered file is accounted for** — indexed, classified as an artifact, or flagged
  with a named requirement. `unknown_files` should be 0.

## What "coverage" means

`source_resolution_coverage = (resolved_full + resolved_partial source-like files) / source-like
files`. Files needing runtime/grammar are excluded from "resolved" and counted as blocking gaps —
coverage is reported *honestly low* rather than inflated.

## Reproduce

```bash
omnicode benchmark <repo> --no-write          # one repo, prints the table
omnicode resolve-all <repo> --no-write        # full per-file ledger
npm run bench -- benchmarks/repos.txt          # matrix; each repo in an isolated child process
```

## Known limitations (don't hide these)

- chars÷4 is an approximation of tokenization; real tokenizer counts vary ±10–20% by content.
- The baseline assumes "feed raw source," which is the realistic alternative for whole-repo
  context but not the only one (a human might hand-pick files).
- `spaghetti_report` on huge graphs is itself a large payload; it's a deep audit, not a warm
  query — read the warm-query average for the per-interaction cost.
