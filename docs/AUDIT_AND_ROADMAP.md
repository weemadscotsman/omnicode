# OmniCode Comprehensive Audit & Technical Roadmap

> **📌 HISTORICAL — largely superseded.** This was the *original* gap audit. Most items below are
> now shipped, and some descriptions are stale (e.g. search is no longer fuse.js but BM25 + PageRank
> WRR fusion; parsing is native `tree-sitter`, not `web-tree-sitter`; call edges, `get_call_hierarchy`,
> `get_symbol_complexity`, `get_churn_rate`, token-budgeted `get_ranked_context`, and the
> python/rust/go/c# grammars all exist). For the **current** status see
> [`/PARITY_MATRIX.md`](../../PARITY_MATRIX.md), [`/CHANGELOG.md`](../../CHANGELOG.md), and
> [`CLAIMS_AND_LIMITS.md`](CLAIMS_AND_LIMITS.md). The one genuinely-open item from this audit is
> **real semantic embeddings** (the WRR similarity channel is still dark). Kept as a record of the
> original plan.

## Executive Summary

While OmniCode has established a baseline of powerful structural, AST-based retrieval features (fuzzy search, dead code detection, contextual bundles, rename safety), a comprehensive audit reveals significant functional gaps when compared against top-tier state-of-the-art MCP servers (like `jcodemunch-mcp`). 

To dominate the MCP ecosystem and definitively outperform benchmarks for completeness, token-efficiency, and rich results, OmniCode must graduate from a strict "AST + Fuzzy match" tool into a **Context-Aware, Multi-Signal Reasoning Engine**.

Here is the full audit of missing features, incomplete systems, and the roadmap to implement them.

---

## 🏗️ 1. Parser & Language Limitations (Critical Gap)

### Current State
OmniCode's initial AST parsing relies on `web-tree-sitter` targeted likely at JavaScript/TypeScript and typical web languages.

### The Gap
Top-tier servers support **70+ languages** out of the box (Python, Go, Rust, Java, C#, PHP, Swift, etc.) with custom extractors for structurally weird languages (e.g., Erlang, Fortran, or SQL pre-processing).

### The Fix: Unified Language Registry
- **Dependency:** Add `tree-sitter-*` language packs dynamically or bundle a broad suite of WASM parsers.
- **Implementation:** Create a `LanguageRegistry` that maps file extensions to AST specs. Each spec defines the local `symbol_node_types` (e.g., in Python `function_definition` vs JS `function_declaration`).

---

## 🕸️ 2. File-Level vs. Symbol-Level Call Graphs (High Priority)

### Current State
OmniCode maintains a basic `edges` table showing what depends on what, but our exact logic heavily conflates *File Imports* with *Function Calls*.

### The Gap
We need **Call Hierarchies (`call_references`)**. True blast radius checking requires tracking `call_expression` nodes in the AST to see exactly which function invokes which other function, bypassing the file-level import graph entirely.
Missing tools:
- `get_call_hierarchy`: (Direction: Callers / Callees, Depth: N).
- `get_impact_preview`: Real transitive breakage tracking at the symbol level.

### The Fix
Update the AST extractor to parse function bodies for identifiers and `call_expression` nodes, mapping them to imported symbols and storing them in a `call_edges` SQLite table.

---

## 🧠 3. Semantic / Hybrid Search (Feature Deficit)

### Current State
Search relies 100% on `fuse.js` (Lexical / Fuzzy). If a developer searches for "database connection pooling", `fuse.js` fails completely if the symbol is named `SqlConnWorker`. 

### The Gap
The system needs **Vector Embeddings (Semantic Search)**. 

### The Fix: Local ONNX Encoders
- Implement a zero-cost local embedding feature (using an ONNX runtime with a lightweight model like `all-MiniLM-L6-v2`) or optional API (OpenAI/Gemini). 
- Store vectors in a SQLite `symbol_embeddings` table. 
- Implement **Signal Fusion**: Combine `fuse.js` fuzzy scoring with `Cosine Similarity` vector scoring to create a combined rank.

---

## 📏 4. Code Quality & Git Churn Metrics (Rich Context Gap)

### Current State
OmniCode tracks basic metadata (line numbers, sizes) but has no concept of code lifecycle or objective quality.

### The Gap
AI agents operate blindly lacking Git provenance or McCabe cyclomatic complexity. Risky refactors require historical context.
Missing Tools / Data:
- `get_symbol_complexity`: Cyclomatic complexity, max nesting depth, parameter counts. Computed from AST nodes.
- `get_churn_rate`: Cross-reference file/symbol with `git log -L` to track how often it changes.
- `get_symbol_provenance`: Who authored it, why (commit messages), and bugfix histories.

### The Fix
Calculate structural complexity at index-time and store it in the `symbols` table. Add lightweight bash `git` sub-process listeners for churn.

---

## 🗜️ 5. Token Budgets & Data Truncation (Efficiency Deficit)

### Current State
Tools like `get_context_bundle` blindly append strings until they are done. On large mono-repos, this could overflow a 128k context window.

### The Gap
No Greedy Packing / Token Management.

### The Fix
- Implement `get_ranked_context(query, token_budget=4000)`. 
- Use a fast heuristic (`text.length / 4`) or `tiktoken` equivalent. 
- The tool must evaluate the relevance of symbols and pack the highest-value code segments unconditionally until the precise token budget is exhausted, then append a `_meta: { truncated: true }` tag.

---

## 🔍 6. Structural Pattern Matching (`search_ast`)

### Current State
Agents can find symbols by name.

### The Gap
There is no way to search for **anti-patterns** across the codebase. 

### The Fix
Build a `search_ast` tool that allows mini-DSL structural queries or common presets:
- `empty_catch` (find all empty try/catch blocks).
- `hardcoded_secret` (find credential assignments).
- `nested_loops` (find O(n^3) complexities to refactor).

---

## 📡 7. Telemetry & AI Summarization 

### Current State
`get_session_stats` emits a hardcoded "98.7% saved" stub string.

### The Gap
Real-time verifiable telemetry. Also, lack of AI summarization (Docstring creation).

### The Fix
- Intercept actual payload sizes vs the baseline sizes of reading raw files. Keep a running tally in the Node.js process using a Singleton.
- Add an optional background worker that sweeps the index using lightweight LLM calls to generate `summary` fields for undocumented functions.

---

## 🏁 Roadmap to Completion

**Phase 1: Deep Mapping (Weeks 1-2)**
- [ ] Migrate `edges` to support both `import_edges` and `call_edges`.
- [ ] Add `get_call_hierarchy` and `get_symbol_complexity`.

**Phase 2: Hybrid Search Pipeline (Weeks 3-4)**
- [ ] Integrate local embedding model storage in SQLite.
- [ ] Build `search_text` for raw full-text lookup fallback.
- [ ] Implement query rank fusion (Fuzzy % + Cosine % + PageRank Centrality %).

**Phase 3: Cross-Language & Constraints (Weeks 5-6)**
- [ ] Implement `token_budget` truncation for `get_context_bundle`.
- [ ] Expand Tree-Sitter WASM binaries to include Python, Rust, Go, Java, and C#.

**Phase 4: Ecosystem Tools (Weeks 7+)**
- [ ] Add Git provenance integration (`get_churn_rate`).
- [ ] Add AST anti-pattern tracking (`search_ast`).

By closing these gaps, OmniCode will decisively outclass all existing Python and Node.js-based RAG variants, operating as an entirely localized, hybrid-search, AST-aware intelligence backbone.
