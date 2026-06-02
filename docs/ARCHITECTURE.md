# Architecture

> **Version note:** This document describes the current high-level architecture of OmniCode-MCP. Exact tool names and optional integrations may evolve over time.

---

## Table of Contents

* [System Overview](#system-overview)
* [Design Goals](#design-goals)
* [Directory Structure](#directory-structure)
* [High-Level Data Flow](#high-level-data-flow)
* [Core Architectural Concepts](#core-architectural-concepts)
* [Parsing and Symbol Extraction](#parsing-and-symbol-extraction)
* [Storage Model](#storage-model)
* [Search and Retrieval](#search-and-retrieval)

---

## System Overview

OmniCode-MCP is a local-first structured code retrieval system for AI agents, built with TypeScript, Tree-Sitter, and SQLite.

Its purpose is to let an MCP-compatible client explore a repository by symbol, outline, structure, and tightly scoped context instead of repeatedly opening large files and scanning them linearly. It indexes source code once, extracts symbols with Tree-Sitter, stores stable symbol metadata, and serves precise retrieval and search operations through an MCP server.

---

## Design Goals

OmniCode is built around the following priorities:

1. **Minimize tokens sent to the model** by retrieving only relevant code.
2. **Lightning-fast performance** using SQLite (`better-sqlite3`) for metadata persistence, and a
   **worker-thread pool** for parallel parsing of large repos.
3. **Resiliency** with optional background file-watching (`chokidar`) plus a `force` reindex for
   engine upgrades.
4. **Ranked retrieval** — Weighted Reciprocal Rank fusion over identity + BM25 lexical + PageRank
   structural channels, with a calibrated confidence score. (A semantic/embedding channel is
   present but dark until a real local model is wired in.)
5. **Impact analysis + repair governance** out of the box (`blast_radius`, `dead_code_scan`,
   proof-gated `repair_plan`).

---

## High-Level Data Flow

```text
Local folder
    │
    ▼
Discovery / Chokidar Watcher
    │
    ▼
Tree-Sitter Parsing & AST Traversal
    │
    ▼
Symbol Extraction (functions, classes, variables, margins)
    │
    ▼
SQLite Persistence & Index Generation
    │
    ▼
MCP Consumers (Cursor, Claude, etc.)
(search, retrieval, outlines, blast radius, dependencies)
```

---

## Core Architectural Concepts

### 1. Index once, retrieve many times
The main performance strategy is to pay the parsing and indexing cost once, then make subsequent searches and retrievals cheap and precise. 

### 2. Local-first SQLite storage
Indexes live inside a per-repository SQLite database (under `~/.omnicode`, keyed by repo path). It
tracks `files` (with `parser_mode`, `parse_quality`, `pagerank`), `symbols` (+ `symbol_embeddings`),
`imports`, `call_edges`, resolved `edges`, `blindspots`, `index_meta` (partial-index state), and a
hash-chained `audit` log.

### 3. File Watching (optional)
After `index_project`, a `chokidar` watcher can monitor for changes and trigger incremental updates
— but it is **auto-skipped on large repos** and can be disabled with `no_watch: true`. A `force`
reindex re-parses every file (use after an engine/parser upgrade).

### 4. Ranked retrieval (WRR fusion)
When an agent calls `search_symbols`, results are scored by **Weighted Reciprocal Rank fusion**
over three independent channels: **identity** (exact/prefix/substring name match, highest weight),
**lexical** (real Okapi BM25 over symbol/path/kind tokens), and **structural** (PageRank centrality
as a tiebreaker). A **calibrated confidence** (gap × strength × identity × freshness) is attached
so the agent knows whether to trust the top hit or widen the search. (`retrieval/signal_fusion.ts`,
`retrieval/bm25.ts`, `retrieval/confidence.ts`.)

### 5. Importance Scoring (real PageRank)
OmniCode runs **PageRank over the file import graph** (damping 0.85, dangling-node correction) and
fuses it with call-graph in-degree to produce each symbol's `importance_score` — surfacing genuine
architectural hubs (not just call counts) and identifying `sleeping` / `dead` code paths.

### 6. Repair governor
A repair lane that is **governance, not mutation**: `repair_plan` / `write_repair_handoff` emit
advisory Markdown and **refuse destructive edits** on a partial index or while repo vision is HIGH
risk (unresolved imports, dynamic references, weak parser coverage).

---

## Parsing and Symbol Extraction

The parsing engine uses **native `tree-sitter`** (with deterministic regex fallback for languages
without a loaded grammar). Parsing runs across a **worker-thread pool** (`engine/parse_pool.ts`);
workers share the parent Node runtime so the native ABI always matches, and **all SQLite writes
stay on a single coordinator thread**. The parser emits normalized symbol records (functions,
classes, methods, interfaces, types, enums), constructs import + call edges, and records typed
**blindspots** (parse errors, dynamic references, skipped/minified files) for transparency. Symbol
names are validated against a reserved-word guard so language keywords never leak in as "symbols",
and the parse buffer is sized to the file so large files (>32KB) get a full AST rather than
silently degrading to regex.

Archives (`.zip`/`.cbz`/`.epub`/`.jar`) are streamed to a temp dir (hardened against zip-slip and
zip-bomb) and then indexed as an ordinary directory.
