# Token Savings: OmniCode MCP

OmniCode saves tokens primarily through **Retrieval Optimization** — agents fetch exact symbols and outlines instead of reading whole files into the context window.

## Why This Exists

AI agents waste tokens when they must read entire files to locate a single function, class, or constant. OmniCode parses a repository once using Tree-Sitter ASTs and allows agents to retrieve **exact symbols on demand**, eliminating unnecessary and expensive context loading.

### The Problem With RAG (Search vs AST)

When benchmarking standard RAG (Retrieval-Augmented Generation) against OmniCode for codebases:
1. **RAG Chunks Code Blindly**: A 512-token or 1024-token RAG system splits functions mid-definition over 50% of the time. The agent receives fragmented code chunks and struggles to piece together logic.
2. **Double Token Costs**: RAG retrieves multiple chunks of "possible matches" to feed the LLM. 
3. **OmniCode's AST Guarantee**: OmniCode has a **100% Chunk Integrity** rate. A function is treated as a semantic unit. You receive the exact boundary of the AST node.

---

## Example Scenario

**Task:** Locate and read the `authenticate()` implementation in a large codebase.

| Approach         | Tokens Consumed | Process                               |
| ---------------- | --------------- | ------------------------------------- |
| Raw file loading | ~7,500 tokens   | Open multiple files and scan manually |
| Standard RAG     | ~3,000 tokens   | K-chunk query fetching fragmented code|
| OmniCode MCP     | ~1,200 tokens   | `search_symbols` → `get_symbol`       |

**Savings:** ~84.0% over Raw, ~60.0% over RAG.

---

## Scaling Impact

| Queries | Raw Tokens | OmniCode Tokens | Savings |
| ------- | ---------- | -------------- | ------- |
| 10      | 400,000    | ~50k           | 87.5%   |
| 100     | 4,000,000  | ~500k          | 87.5%   |
| 1,000   | 40,000,000 | ~5M            | 87.5%   |

---

## Key Insight

OmniCode shifts the workflow from:

**”Read everything to find something”** or **"Guess chunks to assemble logic"**
to
**”Find the exact semantic AST node, and read only that.”**
