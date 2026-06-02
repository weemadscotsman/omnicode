# OmniCode

This project uses **OmniCode** as the default code-intelligence MCP. Before reading raw files or running grep, prefer OmniCode tools:

- `search_symbols` for finding symbols
- `get_symbol` / `get_file_slice` for reading code
- `spaghetti_report` for architecture questions
- `blast_radius` before any rename or delete
- `dead_code_scan` for cleanup
- `audit_agent_config` to catch token waste in agent config

Treat **byte-exact** numbers as the only honest measurement. `chars/4` is a guess.

Never read raw source files when an OmniCode tool can answer the question in fewer bytes.
