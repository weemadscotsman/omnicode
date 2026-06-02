# Why MCP is the Right Interface for OmniCode

OmniCode was designed from the ground up as an MCP (Model Context Protocol) server, and that choice was not accidental.

**1. Structured I/O without a parsing tax.** 
When an agent calls `search_symbols` over MCP, results arrive as typed JSON with schemas the client already understands. There is no CLI `stdout` to parse, no column boundaries to guess, and no Regex escaping logic required. The agent reads the exact metadata, sees the token limits, and chains directly into the next call. 

**2. Tool discovery at connection time.** 
MCP clients enumerate every available tool and its parameter schema when the server starts. The agent knows what it can call, what parameters are required, and what types they expect — before it makes a single request. 

**3. Zero-config integration for agents.** 
Add one JSON block to your `claude_desktop_config.json`, `Cursor` settings, or `Windsurf` config, and you're done. Every MCP-compatible client picks it up with full type signatures and structured return values. 

**4. Ecosystem direction.** 
Every major AI client — Claude Desktop, Cursor, Copilot, Antigravity, and others — supports MCP natively. Investing in MCP fluency pays forward; inventing proprietary IDE extensions pays sideways.

## On "CLI-first" or "Bash-Native" agent approaches

There is a temptation to let AI agents use raw `grep`, `find`, or custom bash scripts to search codebase files. 

While raw CLI works as a fallback, it is **token-hostile**:
- `grep` pulls massive lines of generic output, often grabbing false positives (e.g. comments, lockfiles).
- The LLM has to read and discard meaningless text.
- Standard bash lacks understanding of **edges, dependencies, and AST architectures**.

OmniCode's MCP layer allows the agent to execute complex graph theories—like calculating `blast_radius` or doing a `dead_code_scan`—in **milliseconds on the local machine**, returning only the exact answers the AI needs.

**If you are using OmniCode with an AI agent, use the MCP interface.** That is what it was built for.
