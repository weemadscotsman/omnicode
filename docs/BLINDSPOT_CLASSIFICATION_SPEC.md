# OmniCode Blindspot Classification & Learning Spec

Status: DRAFT / proposal
Author: design pass, grounded in `src/engine/parser.ts`, `src/engine/repo_vision_gate.ts`,
`src/tools/blindspot_report.ts`, `src/store/db.ts`.

## 0. North star: coverage is the product

The entire reason this MCP exists: let an agent work a project **end-to-end until it's
production-ready and shipped** while spending a fraction of the tokens. That only holds if the
agent can reach **every file's content through the index** and never has to fall back to a raw
read. The instant it falls back, the savings for that file are gone.

Therefore the governing metric is **coverage = queryable_files / discovered_files**, and the
target is **1.0**. A blindspot is not a "warning." It is a **token leak**: a file the agent
will be forced to read raw. A repo full of leaks cannot carry a user to shipped, so it is
useless — that is the bar.

### The coverage gap is real and currently unmeasured
The benchmark reports "99.9% savings" against the raw tokens of the *whole* repo, but only the
indexed slice is actually queryable:

| Repo | files discovered | files indexed | coverage |
|---|---:|---:|---:|
| PURPCLAW | 2256 | 433 | 19% |
| new app | 1282 | 645 | 50% |
| GOTHAM_3077 | 7941 | 1502 | 19% |
| ai-town | 217 | 136 | 63% |

The savings headline is true for the covered slice but silent about the ~80% that isn't. If the
agent needs an unindexed file, it pays full raw cost. **Coverage must be a first-class,
reported number, and the savings claim must be stated *at* that coverage** (e.g. "99.9% on 19%
covered" is honest; "99.9%" alone is not).

### Every file gets a queryable representation — no exceptions
A file the parser can't turn into symbols still must be reachable cheaply. Tiered fallback so
coverage can hit 1.0 even when parse quality can't:

1. **symbols** (tree-sitter) — best, full semantic
2. **fallback symbols** (regex) — partial semantic
3. **structural outline** — headings/sections for docs, keys for config/JSON/YAML
4. **content digest** — summary + signature lines + token count, so the agent decides whether to
   spend the raw read at all

Tier 4 is the floor. A binary/asset still gets a one-line "what is this" stub. **Nothing is
unrepresented.** "Unsupported extension → 0 representation" (today's behavior in `parseSource`)
is the single biggest leak and the first thing to close.

## 0a. Scale with honesty — caps + partial-index reporting (SUPERSEDES "no caps")

> **⚠️ Design correction (2026-06-01).** The "no caps, never stop" approach described in this
> section and section 9 was **superseded** by **scale-with-honesty**. The shipped scanner keeps
> bounded guards (`maxFiles` / `maxBytes` / `maxScanMs` + a per-file `maxFileBytes` cap) *and* a
> **parallel worker pool** for throughput. When a guard trips, the index is marked **partial**
> (`scanResult.stats.stopReason` set → `partialIndex: true`, persisted to `index_meta`) and
> `repair_plan` **refuses destructive edits on a partial index**. This is more honest and safer
> than an unbounded scan that can hang on a 20k-file monorepo: a partial index that *says it's
> partial* beats one that silently never finishes. Verified this session: COMFY_CLAUDE_CODE hits
> `max_files_20000` and returns a useful, honestly-labelled partial. See `/CHANGELOG.md`. The
> "remove all stops / `stopReason` always null" claims below are **historical**, not current.

(Historical rationale follows.) A cap that *stops* a scan was originally seen as incompatible with
the product — if the scanner quits at file 1500, files 1501..N are invisible. The current answer
is not "remove the cap" but "parallelize parsing, keep the cap as a safety guard, and *report*
partial coverage honestly."

### What exists today (all in `scanner.ts`)
Three **hard stops** that `break` the walk and abandon the rest of the repo:
- `maxFiles` (scanner default 20000; **benchmark passes 1500**) → cause of 19% coverage on big repos
- `maxBytes` (250MB)
- `maxScanMs` (180s)

Plus one silent dropper: `if (!isSupportedSourceFile()) continue;` — unsupported files vanish
with no record at all. And one *correct* per-file rule already in place: large-but-authored
files are indexed anyway ("Coverage over speed").

### Target design
1. **Remove the three hard stops.** The scanner always walks the entire tree. No `break` on
   count, bytes, or time.
2. **Stream in bounded chunks** (e.g. 500 files: scan → parse → flush to SQLite → release →
   repeat). Memory stays flat at any repo size; this is what "chunk through anything" means.
3. **`maxFileBytes` / `maxScanMs` demote from stops to *classification signals*** — a huge file
   gets a digest instead of a full parse; a long scan emits progress. Neither ever drops a file.
4. **`isSupportedSourceFile() === false` → Tier-4 stub, not `continue`.** Every discovered file
   becomes a queryable row.

End state: `represented_files == discovered_files`, `stopReason == null`, on every repo.

## 0b. The reframe of "blindspot"

Today a "blindspot" means exactly one thing: **the parser could not fully read this file.**
All six existing codes (`PARSE_ERROR`, `PARSE_FAILURE`, `UNSUPPORTED_EXTENSION`,
`DEGRADED_PARSE`, `DYNAMIC_IMPORT`, `DYNAMIC_RUNTIME_REFERENCE`) are parse-confidence signals
emitted in `parseSource` / `fallbackParse`.

But the thing a user actually cares about is broader:

> "A file may exist for a reason I haven't wired up yet. It's not connected to the graph,
> but it's important to *me* and *later*."

That file parses fine and emits **zero** blindspots today. It is invisible. The current
system cannot represent "undiscovered but intentional context." This spec fixes that by
splitting one overloaded concept into **three independent axes** and adding a learning loop.

## 1. Three axes (stop conflating them)

| Axis | Question it answers | Today | Proposed |
|---|---|---|---|
| **Parse confidence** | "Could I read this file?" | the only axis | keep, rename `parse_blindspots` |
| **Graph connectivity** | "Is this file wired into the project?" | not tracked as a signal | NEW `connectivity` axis |
| **User intent** | "Does the human think this matters?" | not tracked at all | NEW learned `intent_score` |

A file can be perfectly parsed (`parse_quality 1.0`), fully disconnected (`0` edges), and
high intent (user opens it every session). Today that file is "clean." That's the bug.

## 2. Connectivity taxonomy (the new category you asked for)

Computed at index time from `imports` + `edges`, NOT from parse failures.

| Class | Definition | Default handling |
|---|---|---|
| `CONNECTED` | imported-by ≥1 AND imports ≥1 | normal |
| `SOURCE_ONLY` | imports things but nothing imports it (entrypoints, CLIs, pages) | normal — likely a root |
| `SINK_ONLY` | imported by ≥1 but imports nothing (leaf utils, types, constants) | normal — likely a leaf |
| `ORPHAN_STAGED` | 0 in, 0 out, but parses clean and has ≥1 exported symbol | **surface, never auto-delete** |
| `ORPHAN_INERT` | 0 in, 0 out, no exports (scratch, dead scaffold) | low-priority surface |
| `ORPHAN_CONFIG` | 0 in/0 out but matches config/asset heuristic (`.env*`, `*.config.*`, fixtures) | informational only |

`ORPHAN_STAGED` is the headline. It is the "I built this for later" file. It must **never**
flow into a destructive repair candidate just because the graph thinks it's unreferenced —
that's exactly the user-trust failure we're avoiding.

### Heuristic to separate STAGED from INERT/dead
- has ≥1 `export`/public symbol → leans STAGED (it offers an API nobody calls *yet*)
- referenced by string (dynamic import, route table, registry) → STAGED, not orphan at all
- file mtime within recent window OR sits in a dir with active siblings → STAGED
- zero symbols + zero exports + old mtime → INERT (safe to deprioritize, still not auto-delete)

## 3. Schema changes

`blindspots` is currently `(id, file_id, reason)` — flat, per-reason, no dedup, which is what
produces the >100% "rate." Proposed:

```sql
-- new: per-file connectivity + intent, one row per file
CREATE TABLE IF NOT EXISTS file_signals (
  file_id        TEXT PRIMARY KEY,
  connectivity   TEXT NOT NULL DEFAULT 'CONNECTED', -- enum above
  in_degree      INTEGER DEFAULT 0,
  out_degree     INTEGER DEFAULT 0,
  export_count   INTEGER DEFAULT 0,
  intent_score   REAL DEFAULT 0,        -- learned, 0..1
  last_user_touch DATETIME,             -- last time user opened/pulled this file in a session
  touch_count    INTEGER DEFAULT 0,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
);

-- keep blindspots but make the rate honest: dedup per (file_id, code)
CREATE TABLE IF NOT EXISTS blindspots (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  code TEXT NOT NULL,        -- split out of reason string
  severity TEXT NOT NULL,
  message TEXT,
  hint TEXT,
  UNIQUE(file_id, code),     -- <-- kills the 223% double-count
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
);
```

Migration is additive (matches the existing `ALTER TABLE ... try/catch` pattern in `db.ts`).
`splitReason()` in `blindspot_report.ts` becomes the migration shim that backfills `code`.

### Two honest metrics instead of one misleading one
- **parse_blindspot_rate** = `distinct files with ≥1 parse blindspot / indexed files` (capped at 100%)
- **orphan_rate** = `ORPHAN_* files / indexed files`

These are reported separately. A repo can be 0% parse-blind and 40% orphan — that's a healthy
WIP repo, not a broken index.

## 4. The learning loop (intent_score)

This is the "let it learn what the user thinks is important" part. No ML model required for v1 —
it's a feedback counter that decays.

**Signals to capture** (cheap, all already observable in session tooling):
1. User opens / reads an `ORPHAN_*` file in a session → `+touch`
2. User pulls an orphan into context for a task (`assemble_task_context`, `get_ranked_context`) → `+strong touch`
3. User edits an orphan → strongest signal it's live work
4. An orphan gains its first real graph edge between indexes → auto-promote, retire the flag

**Update rule (v1, explainable, no black box):**
```
intent_score = clamp01( w_open*log1p(opens)
                       + w_pull*log1p(pulls)
                       + w_edit*log1p(edits)
                       + w_recency*recencyDecay(last_user_touch) )
```
Weights live in config so they're tunable per-repo. Recency decay means a file goes quiet if
the user stops touching it — staged work that got abandoned naturally sinks.

**Promotion / demotion:**
- orphan with `intent_score > θ_hi` → ranked like a connected file in repo_map / context bundles
- orphan with `intent_score < θ_lo` and old → demoted to a collapsed "inert" footer, not noise

The point: the user never has to manually tag anything. The system watches what they reach for
and quietly re-weights. That's the record-breaking part — context that *learns the human's map*
of the project, not just the compiler's.

## 5. Gate integration (don't punish roadmaps)

`repo_vision_gate.ts` currently rolls everything into `risk` and blocks repairs at
`blindspotRate > 20`. Split it:

- **parse risk** (real risk): drives `repairAllowed` / `destructiveAllowed` — unchanged logic,
  but fed by the *honest* parse rate so dynamic-heavy repos stop tripping HIGH for no reason.
- **discovery surface** (not risk): orphan/intent stats become an *advisory* block in the report —
  "N staged files the graph hasn't connected; M of them you've touched recently."

Hard rule added to the gate: **`destructiveAllowed` is force-false for any `ORPHAN_STAGED` or
any file with `intent_score > θ_lo`**, regardless of graph degree. A delete/rename candidate
must clear *both* the graph proof AND the intent check. This is the trust guarantee.

## 6. Report changes (`blindspot_report.ts`)

Add three sections after the existing parser-coverage block:

```
Connectivity:
- connected 412 · source-only 18 · sink-only 9 · staged 23 · inert 4 · config 6
Staged context (parses clean, not wired yet):
  • src/agents/router_v2.ts   exports: 4   touched: 3x   intent 0.81  ← you keep reaching for this
  • src/proto/payments.ts     exports: 7   touched: 0x   intent 0.04
Suggested: promote 1 staged file to repo_map (intent above threshold).
```

So the report stops saying "138 blindspots, scary" and starts saying "here are 23 files you
built that aren't connected yet — here's which ones you actually care about."

## 7. Build order

0. **Coverage as a reported metric** — emit `coverage = queryable_files / discovered_files` in
   benchmark + report, and state every savings number *at* its coverage. Honest first. (small)
1. **Close the floor: Tier-4 representation for every file** — `UNSUPPORTED_EXTENSION` and
   parse-failure files get a content digest / outline instead of 0 representation. This is the
   biggest leak; closing it is what makes "end-to-end" actually true. (medium — the real feature)
2. **Honest metrics** — dedup blindspots per `(file_id, code)`, split parse-rate from
   orphan-rate. Kills the >100% anomaly. (small)
3. ✅ **DONE** — Connectivity classifier. `file_signals` table + `refreshFileSignals()` computes
   CONNECTED / SOURCE_ONLY / SINK_ONLY / ORPHAN_STAGED / ORPHAN_INERT / ORPHAN_CONFIG from
   resolved `imports` in/out-degree + symbol count, run after import resolution in both index
   paths. Surfaced in `blindspot_report` (connectivity counts + staged-by-intent list).
4. ✅ **DONE** — `ORPHAN_STAGED` destructive guard. `getFileProtection()` shields staged or
   high-intent files; `repair_plan` refuses a targeted delete/rename with "PROTECTED FILE —
   intent overrides graph evidence." (Full gate parse-risk/discovery split still TODO, but the
   trust guarantee — the part that matters — is enforced.)
5. ✅ **DONE** — Intent loop. `recordFileTouch(repoPath, file, 'open'|'pull'|'edit')` bumps
   per-kind counters and recomputes `intent_score` (weighted log1p + 14-day half-life recency
   decay). Counters persist across re-index for surviving files. **Remaining wiring:** call
   `recordFileTouch` from session tools (assemble_task_context / edits) — the primitive is built
   and tested; the emit points are the last hookup.

Step 0 makes the claim honest. Step 1 makes the claim *true* — full coverage is the product.
Steps 3–5 (orphan/intent) make it learn the human's map on top of full coverage.

## 9. Pipeline wiring — how no-caps + Tier-4 actually land

Traced through `index_project.ts` (the consumer of the scanner). Key finding: **the index loop
is already streaming-safe. Removing the hard stops is low memory risk.** Details:

### What's already correct
- **The write path is already chunked.** `BATCH_SIZE = 50` (line 110): each batch reads file
  contents, parses, flushes per-file transactions, then `files.slice` releases the contents
  before the next batch. Memory from file *content* is bounded by 50 files regardless of repo
  size. We do NOT need to invent chunked flushing — it exists.
- **Incremental skip-check** (line 124): unchanged files (same hash, already have symbols) are
  skipped and just touch `indexed_at`. So full coverage is a one-time cost; re-indexes are cheap.
- **Skipped files already get rows + typed blindspots** (lines 192–209): minified / too-large /
  generated files are inserted with `parser_mode='skipped'` and a reason. That's already a
  Tier-4-ish representation. Coverage for *those* is accounted.

### What's actually unbounded (and whether it matters)
- `scanResult.files[]`, `scannedPaths` Set, `existingFiles` (line 75): one lightweight record per
  file (path/lang/size or id/path). At 50k files this is single-digit MB — **not a real memory
  risk.** No refactor needed to remove the file-count stop.
- **The genuine bottleneck is line 146: `getEmbeddings(sym.snippet)` awaited serially, per
  symbol.** GOTHAM at full coverage is ~17k+ symbols = 17k serial awaits. **This is the cost the
  180s `maxScanMs` cap was actually masking** — not memory, *time*. Removing the time stop is
  safe (it just runs longer), but this loop should be batched/parallelized so full coverage of a
  big repo finishes in reasonable wall-clock. This is the one real perf work item behind no-caps.

### The precise Tier-4 gap
The minified/too-large path already produces rows. The **truly invisible** files are at
`scanner.ts:208` — `if (!isSupportedSourceFile()) continue;` drops unsupported extensions with
**no entry in `skipped[]`**, so they never reach the `recordSkipped` path that would give them a
row. Fix is surgical: route unsupported-but-real files into `skipped[]` (new reason, e.g.
`unsupported_ext`) so the existing `recordSkipped` block (index_project.ts:192) represents them
for free. No new write path — reuse the one that already works.

### Gate alignment is automatic
`partial_index` / `repairAllowed` key off `scanResult.stats.stopReason` (line 218, 254). Once the
hard stops are gone, `stopReason` is always `null` → `partialIndex` always `false` → the gate
correctly treats every index as complete. No-caps and the trust gate agree by construction.

### Net: the no-caps change is smaller than it looked
1. ✅ **DONE** — Removed the three `break` stops in `scanner.ts` (time / file-count / byte).
   The walk always completes; `stopReason` is now always `null` → `partialIndex` always `false`.
   `maxFiles/maxBytes/maxScanMs` remain in `ScanOptions` for back-compat but are inert.
2. ✅ **DONE** — Unsupported-ext files route into `skipped[]` with reason `unsupported_ext`,
   reusing the existing `recordSkipped` path → represented as Tier-4 stub rows
   (`parser_mode='skipped'`). Verified: `./docs` (11 `.md`) went 0 → 11 indexed, 100% coverage.
3. ✅ **DONE (but it was a red herring)** — Replaced the `await getEmbeddings()` per-symbol
   loop with a synchronous `computeEmbedding()`. **Measured impact: ~1.1x / ~11ms across 17k
   symbols — negligible.** The earlier claim that the embeddings loop was "the cost the 180s cap
   was masking" was WRONG. Real measurement: indexing time is dominated by tree-sitter parsing,
   which **already runs in a parallel 7-worker `ParsePool`** off the coordinator thread. The
   serial coordinator path was never the bottleneck. The change is kept because deleting fake
   `async` is honest cleanup, not because it's a speedup.

### Corrected perf finding
The only thing throttling big repos was the **caps** (file-count stop truncating GOTHAM at
1500), not compute. With caps removed, full coverage of a 7941-file repo just takes a few
minutes of already-parallel parsing and nothing kills it mid-run. There is **no remaining perf
emergency**. If future profiling shows a real hotspot, it will be in parsing throughput
(`ParsePool` sizing / tree-sitter), not embeddings or DB writes.

## 10. Zero Unknown Files — resolution ledger ✅ SHIPPED

"Skip" is not a final state. Every discovered file now ends in exactly one of 8 resolution
states with proof (reason + resolver_used + confidence), stored in the `resolution` table.

| State | Meaning |
|---|---|
| `resolved_full` | parsed, symbols + local imports resolved |
| `resolved_partial` | parsed with caveats (fallback parser / local unresolved import / warnings) |
| `resolved_metadata` | not code, but classified + recorded (docs, assets, config, empty) |
| `generated_excluded` | proven generated/minified/vendor artifact |
| `unsafe_excluded` | secret/credential-risk — withheld + logged |
| `requires_runtime` | dynamic/runtime references need execution/LSP/ABI |
| `resolver_missing` | a specific NAMED resolver is required (python/go/rust/…) |
| `failed_with_reason` | failed, error + next fix recorded |

Built (`src/engine/resolution.ts`):
- `classifyFileKind()` → source/test/config/route/schema/abi_runtime/generated/asset/binary/docs/secret_risk.
- `deriveResolution()` maps per-file facts → state with proof. Bare package imports are external
  (not gaps); only leading-dot/alias unresolved imports count, language-agnostically.
- `classifyResolution(db)` runs after import resolution in both index paths.
- `getResolutionCoverage()` / `getResolutionForPath()` for the metric + repair gating.

Wired:
- **CLI** `omnicode resolve-all <repo>` and **MCP** `resolve_all` — write RESOLUTION_REPORT.md,
  resolution.json, unresolved.ndjson, resolver_gaps.md, artifact_manifest.json, source_coverage.json.
- **Repair gating**: `repair_plan` refuses destructive ops on `resolver_missing` / `requires_runtime`
  / `failed_with_reason` targets and on `generated` files.
- **Benchmark**: emits `resolution` block (source coverage, unknown=0, blocking gaps) and a markdown
  headline — the grown-up metric replacing the vague blindspot rate (blindspots kept internally).
- **Scanner fix**: dot-FILES (`.env`, `.npmrc`) no longer silently vanish — only dot-DIRECTORIES
  are skipped, so secret-risk files are classified, never dropped.

Verified: real `./src` run = 52 files, **0 unknown**, 94.2% source coverage, 3 runtime gaps named;
unit tests cover every state incl. .env→unsafe, dynamic→runtime, python→resolver_missing, all 6
reports, and destructive refusal on unresolved targets. Full suite **137 passing** (2026-06-01).

### Resolver-aware (corrected): credit what we resolve, name only true gaps
The engine ships working import resolvers for **every supported source language**: TS/JS,
Python, Rust, Go, C#, Ruby, Java/Kotlin, PHP, C/C++, Swift, Solidity (`resolveSpecifier` in
`pagerank.ts`). Added across recent passes:
- Ruby: `require_relative` → sibling / load-root (`lib/`,`app/`) / unique basename.
- JVM: `import com.foo.Bar` → `.../com/foo/Bar.(java|kt)`, wildcard → package dir, class fallback.
- PHP: Composer **PSR-4** (`use App\Foo\Bar` → `<psr4-dir>/Foo/Bar.php`) + relative require/include;
  vendor/framework imports → external.
- C/C++: quoted `#include "foo.h"` → relative / include roots; angle `<stdio.h>` → external.
  Header prototypes index as symbols so declaration-only headers resolve.
- Swift: `import Module` → SwiftPM target (`Sources/<Module>/`) or named folder; frameworks
  (Foundation/UIKit) → external. Swift symbol extraction added (was a black hole before).
- Solidity (ABI/runtime): `.sol` is now a first-class scanned + parsed language. `import "./X.sol"`
  → resolved; `@openzeppelin/...` → external (or vendored node_modules). contract/function/event/
  modifier/struct symbols extracted. ABI **JSON** artifacts classified as `abi_runtime` /
  `resolved_metadata`. This kills the blockchain blindspot class for contract source.

The ledger KNOWS which languages it can resolve:
- For those languages, bare specifiers are external (not gaps); only unresolved relative/alias
  imports lower confidence. A Python package whose `.helper` import resolves → `resolved_full`.
- For languages with NO resolver (Java, Kotlin, PHP, Ruby, Swift, C/C++), extracted-but-unresolved
  imports → `resolver_missing` with the EXACT named requirement (e.g. "jvm resolver (Gradle/Maven
  / packages)", "ruby resolver (Gemfile / require paths)").
- A source file no grammar can read → `resolver_missing` naming the grammar, never "metadata".

Verified: a mixed repo (py package + ruby + java) → python `resolved_full`, ruby+java
`resolver_missing` with named gaps, `unknown=0`. This is the dominance posture: prove what you
understand, name precisely what you don't.

### End state reached
Every supported source language now has an import resolver. `resolver_missing` no longer fires
for any supported language whose fallback extracts symbols — it is reserved for (a) files the
fallback genuinely can't read (→ NAMED "needs a native <lang> grammar"), and (b) truly
unsupported file types. The only remaining work is **polish, not gaps**:
- Native tree-sitter grammars for fallback languages (Ruby/Java/Kotlin/PHP/C/C++/Swift/Solidity)
  to lift `resolved_partial` → `resolved_full`. Explicitly deprioritized — partial is honest+usable.
- Optional: deep ABI-JSON method/event extraction, `compile_commands.json` for C/C++,
  per-target Swift module graphs. All enhancements, none are black holes.

`resolve-all` now says: "Everything is accounted for; source resolved across 11 language
families; the only unknowns are files needing runtime proof or a native-grammar upgrade." That
is the best-in-show end state.

## 8. Open questions
- Where do session touch events get emitted today? (need to confirm `assemble_task_context` /
  `get_ranked_context` can fire a hook into `file_signals`.)
- Decay window default — 14d? per-repo configurable.
- Should `ORPHAN_CONFIG` detection be a denylist of globs or a learned class too?
