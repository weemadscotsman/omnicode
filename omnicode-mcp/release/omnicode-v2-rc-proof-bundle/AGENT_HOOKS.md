# Agent Hooks And Prompt Policies

Installing OmniCode only makes the MCP server available. It does not force an agent to use it. Add
a small policy to the agent's project instructions so it starts with OmniCode before burning tokens
on broad file reads.

## Recommended Policy

```markdown
## OmniCode Policy

When OmniCode MCP is available, use it before broad code exploration.

First call for any repo session:
- `session_resume_brief { "path": "<repo>" }`

In compressed mode, only five public tools are visible:
- `health_check`
- `list_tools`
- `get_tool_schema`
- `invoke_tool`
- `session_resume_brief`

Use `get_tool_schema` to load exactly one internal tool schema, then `invoke_tool` to call it.

Preferred internal tools:
- repo state: `repo_map`
- file shape: `file_outline`
- symbol search: `search_symbols`
- exact symbol source: `get_symbol`
- file plus direct dependencies: `get_file_context`
- impact/risk: `blast_radius`, `dependency_map`
- parser and visibility gaps: `blindspot_report`, `resolve_all`
- code-health report: `spaghetti_report`
- advisory repair plan: `write_repair_handoff`
- benchmark proof: `benchmark`

Do not treat `spaghetti_report` as a repair command. It reports only.
Do not treat `write_repair_handoff` as a patch command. It writes Markdown only.

Native file and shell tools are allowed for exact known paths, edits, build/test commands, and
cases where OmniCode cannot answer.
```

## Where To Put It

Common locations:

| Agent/editor | Typical instruction file |
|---|---|
| Codex | `AGENTS.md` |
| Claude Code | `CLAUDE.md` |
| Cursor | `.cursorrules` or `.cursor/rules/omnicode.mdc` |
| Windsurf | `.windsurfrules` |
| Cline/Roo | project rules file supported by the extension |

Preserve existing user instructions. Add OmniCode policy as a small section, not as a replacement.
