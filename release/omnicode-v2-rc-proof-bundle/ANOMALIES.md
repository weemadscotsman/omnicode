# Anomalies — Why "scary" numbers are honest, not failures

OmniCode reports its own uncertainty. That means some metrics *look* alarming until you know what
they mean. This doc explains them so nobody mistakes transparency for breakage.

## High blindspot rate (e.g. 81–87% on large repos)

A **blindspot** is an honest "I see this but can't statically resolve it" flag. It does **not**
force a raw-source fallback, so it never costs token savings. On a real PURPCLAW run, the 87%
broke down as:

- **~93% of the blindspots were `skipped:unsupported_ext`** — `.ps1`, `.log`, `.env`, and other
  non-source files *correctly classified as artifacts*, not unresolved code.
- The actual code-level flags were tiny: a few dozen `DYNAMIC_IMPORT` / `DYNAMIC_RUNTIME_REFERENCE`
  / `PARSE_ERROR` across thousands of files.

Run `omnicode blindspots <repo> --explain` to see the breakdown and the *why* for each class.

## Blindspot rate over 100% (e.g. 191%)

This is a **counting artifact, reported honestly**: the legacy `blindspot_rate` divides total
blindspot *reasons* by file count, and one file can emit several reasons (e.g. `DEGRADED_PARSE` +
`DYNAMIC_RUNTIME_REFERENCE`). So the rate can exceed 100%.

The Blindspot Explorer reports the **honest per-file rate** (`files with ≥1 blindspot / files`)
alongside it, which is always ≤ 100%. Prefer the per-file rate.

## Largest file skipped artifact

`largest_file_skipped_artifact:<path>:<bytes>` means the largest file in the repo was classified
as an artifact, binary, archive, generated file, metadata, or other non-source item. This is not a
failure. It is the benchmark refusing to use a non-source blob as a source-understanding baseline.

This anomaly exists because an earlier benchmark run found `ghostlink-pro.zip` was correctly
classified as skipped, but the old `file_outline` selector still used it as the largest file
baseline. That inflated the aggregate reduction factor. The inflated aggregate was discarded.

Current behavior:

- `file_outline` benchmarks only parseable source/test/route files with symbols.
- Archives, binaries, docs, generated files, unsafe files, metadata-only files, and skipped
  artifacts are excluded.
- If no eligible file exists, `file_outline` is marked skipped with
  `file_outline_skipped:no_parseable_source_file`.
- Skipped operations do not invent baselines and do not inflate cumulative totals.

If this anomaly appears alongside `file_outline_selector:source_only`, the selector did the right
thing: it ignored the artifact and picked the largest eligible source file instead.

## `requires_runtime` files (e.g. 24 in a Roblox Lua repo)

Some references genuinely can't be resolved without execution — `require(game.X.Y)` in Roblox
Lua, `import(someVar)`, reflection, ABI calls. OmniCode flags these `requires_runtime` with the
exact reason, rather than guessing or calling them dead. That's correct behavior, and the repair
governor refuses destructive edits against them.

## Source coverage that looks low (e.g. 18.8%)

When a repo is mostly dynamic (Roblox Lua) or mostly non-source (assets/data), coverage is
reported *low and true* instead of inflated. A repo with 0 source files reports `n/a`, never a
fake "100%".

## The principle

Rivals can say "we parsed what we could." OmniCode says: **here is every file, its state, its
resolver, its confidence, and what we refuse to touch.** The honest number is the feature.
