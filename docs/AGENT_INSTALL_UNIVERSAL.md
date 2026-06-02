# Universal Agent Installer Prompt for OmniCode

Use this when an agent environment does not have a dedicated OmniCode installer. The goal is not to
teach the agent every internal tool. The goal is to teach it the trust-layer order:

1. start with `session_resume_brief`
2. use `list_tools` for compact discovery
3. load exactly one schema with `get_tool_schema`
4. call hidden tools through `invoke_tool`
5. avoid raw repo reads unless OmniCode cannot answer

## Prompt

```text
You are installing OmniCode MCP usage guidance into your own environment.

First verify whether OmniCode MCP is available. In compressed mode you should see only:
- health_check
- list_tools
- get_tool_schema
- invoke_tool
- session_resume_brief

Do not assume all internal tools are directly visible. OmniCode defaults to compressed mode.

Install these operating rules into the appropriate local/project instruction file for this agent
environment, preserving existing user content:

## OmniCode Code-Exploration Policy

When OmniCode MCP is available, use it before broad file reads for codebase exploration.

Start every repo session with:
- session_resume_brief { "path": "<repo>" }

Then:
- use list_tools for compact tool discovery
- use get_tool_schema for exactly one internal tool schema when needed
- use invoke_tool to call internal OmniCode tools

Default internal tool flow:
- need repo state: repo_map
- need one file shape: file_outline
- need symbol search: search_symbols
- need exact code: get_symbol
- need one file plus direct deps: get_file_context
- need impact: blast_radius or dependency_map
- need health/risk: spaghetti_report, blindspot_report, resolve_all
- need benchmark proof: benchmark
- need handoff only: write_repair_handoff

Do not treat No Spaghett as an auto-repair tool. spaghetti_report reports. write_repair_handoff
writes Markdown only. Source edits remain a separate human/agent action after review.

Native file/shell tools are still allowed for:
- exact known file paths
- editing files after a plan is approved
- build/test commands
- files outside the indexed repo
- cases where OmniCode says the repo is not indexed or cannot answer

Do not claim the install succeeded until the instruction file exists and includes the OmniCode
policy above.
```

## Verification

After installing the prompt policy, test a fresh session:

1. call `health_check`
2. call `session_resume_brief` on a small repo
3. call `get_tool_schema` for `repo_map`
4. call `invoke_tool` for `repo_map`
