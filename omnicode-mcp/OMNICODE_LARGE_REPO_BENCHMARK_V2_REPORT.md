# OmniCode Large-Repo + Benchmark v2 Fix Report

## What this patch fixes

This patch turns the COMFY_CLAUDE_CODE timeout from a dead-end into a controlled stress-test mode.

### Added

- Large-repo scanner guards:
  - `maxFiles`
  - `maxBytes`
  - `maxScanMs`
  - generated/release artifact skipping
  - symlink skipping
  - repeatable scan stats
- `index_project` now reports:
  - scan time
  - stop reason
  - guard hits
  - skipped/generated counts
  - stale file cleanup count
- Watcher auto-skip for stress repos.
  - Large repos should not spawn a giant chokidar watcher by default.
  - `OMNICODE_WATCHER_MAX_FILES` controls the threshold.
- Benchmark v2:
  - `benchmark` MCP tool
  - `omnicode benchmark <repo>` CLI command
  - measured OmniCode payload tokens
  - estimated raw source tokens
  - explicit `measurement_type` per row
  - `99.9%` cap instead of fake `100%` display
  - `.omnicode/BENCHMARK.md`
  - `.omnicode/benchmark.json`
- Batch benchmarking:
  - `omnicode bench-many repos.txt`
  - writes `benchmarks.ndjson`
  - writes `BENCHMARK_MATRIX.md`
  - flags anomalies
- Remote public GitHub clone/index:
  - `clone_and_index` MCP tool
  - `omnicode clone-index <github_url>` CLI command
  - public HTTPS GitHub only in v0.1
  - no PAT support yet, deliberately
  - shallow clone
  - timeout guard
  - size guard
  - symlink removal

## Why this fixes COMFY_CLAUDE_CODE

COMFY_CLAUDE_CODE timed out because the previous scanner/watcher path tried to treat a twelve-thousand-file, two-hundred-megabyte repo like a normal project.

The patched system now lets you run:

```text
omnicode benchmark "E:\\path\\to\\COMFY_CLAUDE_CODE" --max-files 5000 --max-scan-ms 300000
```

or intentionally full-send it:

```text
omnicode benchmark "E:\\path\\to\\COMFY_CLAUDE_CODE" --max-files 20000 --max-scan-ms 900000
```

If it still hits the guard, it reports the guard instead of pretending the repo failed.

## Honest benchmark rules now enforced

- Raw repo tokens are estimated from source bytes.
- OmniCode output tokens are measured from returned tool text.
- Index output is reported as a measured response payload, not as magical model cost.
- Rows include measurement type.
- Savings near 100% are displayed as 99.9% unless the OmniCode output is actually zero.

## Local validation commands

```text
cd C:\Users\Admin\Downloads\omnicode_review\omnicode-mcp
npm install
npm run build
node dist/cli.js benchmark "E:\god folder\02_ACTIVE_PROJECTS\PVX_BLOCKCHAIN"
node dist/cli.js bench-many repos.txt --max-files 5000
node dist/cli.js clone-index https://github.com/jgravelle/jcodemunch-mcp --fresh
```

## Known remaining work

- True worker-thread parser pool for CPU-bound parsing.
- Parser packages for Python/Rust/Go/C# if you want real symbol extraction there.
- Optional LSP fallback for dynamic languages and TypeScript project references.
- Full compressed two-tool MCP wrapper if you want lowest possible schema-token burn.
