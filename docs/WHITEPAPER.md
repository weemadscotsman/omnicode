# Symbols, Not Chunks: How OmniCode AST Retrieval Beats RAG

---

## Abstract

Large language models (LLMs) consume tokens proportionally to the context they receive. When applied to code understanding tasks, the dominant retrieval strategy — chunk-based Retrieval-Augmented Generation (RAG) using vector embeddings — injects substantial irrelevant context, wastes tokens, and frequently delivers fragments that split functions mid-definition. 

This paper presents an alternative: **AST-based symbol retrieval powered by OmniCode**. OmniCode uses Tree-Sitter parsing to extract complete syntactic units (functions, classes, methods) and SQLite to map their structural relationships, seamlessly "gooping" its way through codebase dependencies. 

In comparisons against a standard fixed-chunk RAG pipeline (e.g., LangChain + FAISS), OmniCode's AST retrieval uses **2x-4x fewer tokens per query**, ensuring 100% chunk integrity. Against a "read all files" baseline, the reduction reaches **95%–99%**. We argue that for code-specific retrieval, the retrieval unit must be the semantic symbol, not the arbitrary chunk.

---

## 1. The Token Cost & Chunking Problem

### The Precision/Recall Tradeoff
Fixed chunk sizes force a tradeoff. Small chunks (e.g., 512 tokens) reduce noise but split functions mid-definition. Large chunks (2048 tokens) preserve structure but include unrelated code. An LLM receiving a fragmented chunk gets the tail of one function and the head of another, reducing its ability to reason reliably about logic.

### RAG for Code is Inherently Flawed
RAG was designed for prose. Code has a strict syntactic structure (functions, classes, modules, interfaces) that prose does not. RAG pipeline steps—chunking, embedding, indexing, retrieval—ignore this structure. 

---

## 2. Approach: OmniCode's AST Retrieval

### Core Idea
Instead of chunking source files into arbitrary token windows, OmniCode parses them into natural syntactic units. It indexes these **symbols** by name, kind, file path, and exact byte offset. At query time, OmniCode searches the symbol index and returns the complete, unfragmented source code.

### "Gooping" Through the Codebase
OmniCode doesn't just stop at extraction; it maps edges. When you query a symbol, OmniCode uses SQLite to traverse `to_symbol` and `from_symbol` relationships effortlessly. This allows the agent to pull exact structural dependencies (`blast_radius`, `find_references`) without embedding lookups and without LLM hallucinations.

### 3. Workflow Comparison

**RAG Workflow:**
1. Embed query.
2. Search Vector DB.
3. Return top `k` chunks (often containing mid-function splits).
4. *Token cost:* Massive (entire chunks loaded regardless of function size).

**OmniCode Workflow:**
1. `search_symbols("middleware")` → returns lightweight metadata (Line numbers, File Paths).
2. `get_symbol("AuthMiddleware")` → returns exact AST node source.
3. *Token cost:* Minimal (only targeting confirmed relevant bounds).

Three properties distinguish OmniCode:
1. **Metadata First:** The LLM can inspect symbol names and files before deciding to burn tokens on full-source retrieval.
2. **Complete Syntactic Units:** Every result starts at a definition boundary and ends at its closing delimiter.
3. **Adaptive Sizing:** If a query matches one 10-line symbol, the agent retrieves exactly 10 lines. RAG would pad it out to the nearest 512-token chunk.

---

## 4. End-to-End Task Savings

In real-world tasks (e.g., Naming Audits or Dead Code Detection), OmniCode allows agents to solve problems with highly surgical operations constraints. Instead of pulling files to scan for dead code, tools like `dead_code_scan` calculate this *within the index*, saving the LLM the tokens explicitly. 

The result? OmniCode represents an evolution in coding agents: **from "Read everything to find something" to "Find exactly what matters, and read only that."**
