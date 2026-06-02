# OmniCode Benchmark Methodology

This document provides full methodological detail for the token efficiency benchmarks and internal validations driving OmniCode's architecture.

## Scope

The benchmark measures **retrieval token efficiency** — measuring how many LLM input tokens a code exploration tool consumes compared to reading all source files or querying an arbitrary RAG pipeline. It does **not** measure latency or LLM response time directly, as we assume smaller context windows naturally lead to faster Time-To-First-Token (TTFT).

## Baseline Definition

**Baseline tokens** = all indexed source files concatenated and tokenized. This represents the **minimum** cost for a "read everything first" agent. Real agents typically read files multiple times, so true production savings are significantly higher.

## OmniCode Workflow Evaluation

For query benchmarking, the OmniCode flow looks like this:
1. Call `search_symbols(query, fuzzy_threshold=0.4)` — returns ranked symbol metadata from the SQLite index.
2. Call `get_symbol(name)` on the matching symbol IDs — returns exact source code.
3. **Total tokens** = search metadata tokens + exact symbol tokens.

## Comparison against RAG baselines

Standard LangChain/LlamaIndex vector solutions suffer from Chunk Integrity issues.

When benchmarking OmniCode against a standard 512-token chunking strategy over a large repo (e.g., Express or FastAPI equivalents):
- **Complete Chunk % (RAG)**: Chunks that start with a definition and end cleanly are incredibly rare (~7% to 15% range).
- **Split Chunk % (RAG)**: Upwards of 50% of chunks are split mid-function.
- **OmniCode Integrity**: **100%**. Because OmniCode pulls code directly from `byte_start` to `byte_end` derived from Tree-Sitter AST nodes, code is never fragmented.

## Infrastructure Overhead

| Metric | RAG | OmniCode |
|--------|-----|------------|
| Vector Model Download | ~90 MB to 1GB | None |
| Runtime dependencies | LangChain, FAISS, Torch | Better-SQLite3, Tree-Sitter (Native bindings) |
| Query Latency | 15-50ms (Vector lookup) | <5ms (SQLite lookup + BM25 / PageRank WRR fusion) |
| RAM footprint | High (Model loading) | Minimal (SQLite optimized reads + Chokidar) |

## Token Counting

We measure exact efficiency tracking context payloads through TikToken `cl100k_base` equivalents or Anthropic token counters to verify the savings emitted in `get_session_stats`.
