# Claims And Limits

OmniCode should be judged by reproducible claims, not marketing fog. This file states what is
claimed, what is proven, and what is not claimed.

## Release Claim Table

| Claim | Status | Evidence / limit |
|---|---|---|
| Byte-exact reduction | Proven for the selector-fixed ten-repo rerun | `BENCHMARK_FINAL.md` reports 10 repos, 0 errors, 13,041 files accounted, 0 unknown files, 99.525269% measured byte reduction, 210.65x factor. |
| Exact-byte methodology | Claimed and documented | `METHODOLOGY.md` defines `baseline_bytes`, `payload_bytes`, and exact reduction math. Estimated tokens are labeled estimates, not headline proof. |
| Previous inflated aggregate was discarded | Claimed and documented | The old archive-inflated aggregate was rejected after `ghostlink-pro.zip` exposed a `file_outline` selector bug. |
| Source-outline artifact exclusion | Claimed and implemented | `file_outline` benchmarks select parseable source/test/route files with symbols; archives, binaries, docs, generated files, assets, and skipped artifacts are excluded. |
| Zero Unknown Files ledger | Claimed as the resolution standard | `RESOLUTION_LEDGER_SPEC.md` defines the states. Current proof docs report zero unknown files for named runs. |
| Coverage-complete accounting | Claimed for benchmarked runs where ledger shows all files accounted | This does not mean every file is semantically understood. It means every discovered file ends in a named state. |
| Full semantic understanding of all repos | Not claimed | OmniCode reports parser quality, resolver gaps, runtime-required files, and blindspots. |
| All languages native | Not claimed | JS/TS native parsing is primary. Optional/fallback parser coverage exists for other languages. Native grammar breadth is still a growth area. |
| Dynamic runtime references resolved | Not claimed | Runtime refs are classified and can block destructive handoff planning. They are not guessed. |
| Automatic code repair | Not claimed | No Spaghett is advisory-only. `write_repair_handoff` writes Markdown. It does not edit source code. |
| Safe destructive edits | Not claimed generally | Destructive repair remains blocked unless proof gates pass. The default posture is handoff, not mutation. |
| Public cloud service | Not claimed | Current package is local-first stdio MCP. It does not ship a public HTTP API or hosted dashboard. |
| Secret-safe logging | Claimed with limits | Redaction is applied to audit, memory, and oversized output paths. Users should still avoid intentionally sending secrets through tools. |
| Install is fully painless | Not yet claimed | Current install requires Node and native dependencies. Prebuilt/platform release artifacts are a release gap. |
| Better than every competitor in every feature | Not claimed | OmniCode's current differentiator is auditability, byte-exact benchmark proof, resolution ledger, compressed MCP mode, session brief, and repair handoff posture. |

## What The Headline Means

Launch-safe line:

> Fresh selector-fixed byte-exact rerun: ten repos, zero errors, 13,041 files accounted, zero
> unknown files, measured byte reduction 99.525269%, reduction factor 210.65x.

This means the benchmark operations returned much smaller measured UTF-8 payloads than the measured
source-byte baselines for that exact ten-repo run.

It does not mean:

- every future repo will produce the same reduction
- every language is deeply semantically resolved
- runtime behavior can always be inferred statically
- OmniCode applies repairs automatically
- token counts are exact for every LLM tokenizer

## What "Zero Unknown Files" Means

"Zero unknown files" means every discovered file is classified into a named resolution state. It
does not mean every file is fully parsed or safe to modify.

Examples:

- `resolved_full`: strong static parse
- `resolved_partial`: useful but caveated parse
- `resolved_metadata`: non-source but accounted
- `generated_excluded`: generated/vendor/minified artifact
- `unsafe_excluded`: secret-risk content withheld
- `requires_runtime`: needs runtime/LSP/ABI evidence
- `resolver_missing`: needs a named resolver or grammar
- `failed_with_reason`: parse failed with recorded reason

## Repair Position

OmniCode's repair lane is governance, not mutation.

- `spaghetti_report` reports code-health findings.
- `write_repair_handoff` writes a Markdown handoff.
- `repair_plan` is a backward-compatible alias for the same handoff behavior.
- Source edits are left to a human or separate agent after review.

This is intentional. A static index should not delete or rewrite code just because a graph says a
file is quiet.

## Known Release Gaps

- true prebuilt native binaries/platform packages
- larger hostile-public benchmark matrix
- broader native parser coverage
- real semantic embeddings
- deeper framework/runtime resolvers
- long-running worker pool for very large repos
- public install polish

These are release-engineering and roadmap items, not hidden claims.
