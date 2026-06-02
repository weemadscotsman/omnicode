# OmniCode Repo Vision / Blindspot Fix Report

## What changed

This patch attacks blindspots directly instead of pretending token savings equal full repo understanding.

### Added

- Deterministic fallback parsers for JavaScript/TypeScript, Python, Rust, Go, C#, Java, Kotlin, PHP, Ruby, Swift, C, and C++-style files.
- Native Tree-sitter still wins when installed.
- Files now store `parser_mode`, `parse_quality`, and `language_name` in SQLite.
- Blindspot reasons are now classified with codes, severity, messages, and fix hints.
- `blindspot_report` now reports parser coverage, fallback coverage, unresolved imports, risk level, examples, and next fixes.
- `language_support` now distinguishes native Tree-sitter support from fallback support.
- Scanner includes more real source extensions so polyglot repos are not invisible by default.
- Optional parser dependencies are declared for Python, Rust, Go, and C#.

## Why this matters

Before this patch, a missing parser could make OmniCode hit a wall and report unsupported files without extracting useful structure. Now missing native grammars degrade into fallback mode: symbols/imports/calls are still extracted, and repair tools can attach lower confidence instead of blindly failing.

## Honest limitation

Fallback parsing is not full semantic resolution. It is a bridge. It reduces blind walls and improves context retrieval, but high-risk edits still need native parser, LSP, runtime telemetry, or ABI/framework-specific proof.

## Next layer

- Add TypeScript Compiler API resolver for TS/JS imports and aliases.
- Add Python import resolver using pyproject/setup/module path analysis.
- Add ABI/runtime resolver for PVX-style blockchain blindspots.
- Add worker-thread parser pool for COMFY-scale repos.
- Add repair gates that refuse destructive changes when parse quality is low.
