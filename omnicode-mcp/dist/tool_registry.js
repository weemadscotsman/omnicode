"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLIC_TOOL_NAMES = exports.TOOL_DEFINITIONS = void 0;
exports.getToolMode = getToolMode;
exports.getToolDefinition = getToolDefinition;
exports.getVisibleToolDefinitions = getVisibleToolDefinitions;
exports.toMcpTool = toMcpTool;
exports.toCompactCatalog = toCompactCatalog;
const emptySchema = { type: 'object', properties: {}, required: [] };
const pathSchema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
const symbolSchema = {
    type: 'object',
    properties: { path: { type: 'string' }, symbol_name: { type: 'string' } },
    required: ['path', 'symbol_name'],
};
exports.TOOL_DEFINITIONS = [
    {
        name: 'skill_search',
        category: 'skillvault',
        purpose: 'search a prebuilt skill index and return top-N skill cards',
        permission: 'read-only',
        compression_level: 'public',
        description: 'SkillVault: search the prebuilt skill index for skills matching a free-text query. Returns metadata only (no body). Use skill_load to pull a specific skill body on demand.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                index_path: { type: 'string' },
                limit: { type: 'number' },
            },
            required: ['query'],
        },
    },
    {
        name: 'skill_load',
        category: 'skillvault',
        purpose: 'load one full skill body on demand',
        permission: 'read-only',
        compression_level: 'public',
        description: 'SkillVault: load the full SKILL.md body of one skill by exact name. Use skill_search first to find the right name.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                index_path: { type: 'string' },
            },
            required: ['name'],
        },
    },
    {
        name: 'skill_pack_for_task',
        category: 'skillvault',
        purpose: 'pick a minimal diverse pack of skills for a free-text task',
        permission: 'read-only',
        compression_level: 'public',
        description: 'SkillVault: pick a minimal, diverse pack of skills (top-N) that covers a free-text task. Greedy selection with overlap penalty. Use this BEFORE loading individual skills so you pull only the skills you actually need.',
        inputSchema: {
            type: 'object',
            properties: {
                task: { type: 'string' },
                index_path: { type: 'string' },
                limit: { type: 'number' },
                pool: { type: 'number' },
            },
            required: ['task'],
        },
    },
    {
        name: 'health_check',
        category: 'system',
        purpose: 'prove OmniCode MCP is alive',
        permission: 'read-only',
        compression_level: 'public',
        description: 'Checks if the OmniCode MCP server is running and returns basic status.',
        inputSchema: emptySchema,
    },
    {
        name: 'list_tools',
        category: 'mcp',
        purpose: 'return compact internal tool catalog without full schemas',
        permission: 'read-only',
        compression_level: 'public',
        description: 'List OmniCode tools as compact metadata only. Does not return full schemas.',
        inputSchema: emptySchema,
    },
    {
        name: 'get_tool_schema',
        category: 'mcp',
        purpose: 'load one authorized internal tool schema on demand',
        permission: 'read-only',
        compression_level: 'public',
        description: 'Return the full schema for exactly one authorized OmniCode tool.',
        inputSchema: {
            type: 'object',
            properties: { tool_name: { type: 'string' } },
            required: ['tool_name'],
        },
    },
    {
        name: 'invoke_tool',
        category: 'mcp',
        purpose: 'secure gateway to hidden internal tools',
        permission: 'read-only',
        compression_level: 'public',
        description: 'Invoke an internal OmniCode tool through RBAC, sandbox, audit, and redaction.',
        inputSchema: {
            type: 'object',
            properties: {
                tool_name: { type: 'string' },
                tool_input: { type: 'object' },
            },
            required: ['tool_name', 'tool_input'],
        },
    },
    {
        name: 'session_resume_brief',
        category: 'session',
        purpose: 'start a coding session with compact repo truth',
        permission: 'read-only',
        compression_level: 'public',
        description: 'Return compact repo state, memory, risks, forbidden actions, and next OmniCode tool.',
        inputSchema: pathSchema,
    },
    {
        name: 'index_project',
        category: 'index',
        purpose: 'index or refresh an approved repository',
        permission: 'agent',
        compression_level: 'internal',
        description: 'Index or refresh the approved repository.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Absolute path to the repository to index' },
                max_files: { type: 'number' },
                max_bytes: { type: 'number' },
                max_scan_ms: { type: 'number' },
                no_watch: { type: 'boolean' },
            },
            required: ['path'],
        },
    },
    {
        name: 'search_symbols',
        category: 'retrieval',
        purpose: 'search repo symbols with ranked retrieval',
        permission: 'read-only',
        compression_level: 'internal',
        description: 'Search for symbols across the repository.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                query: { type: 'string' },
                max_results: { type: 'number' },
                fuzzy_threshold: { type: 'number' },
                format: { type: 'string', enum: ['text', 'ocap', 'auto'], description: 'Output format. ocap = row-oriented, path-interned, lower token cost. auto (default) = ocap when >=4 hits.' },
            },
            required: ['path', 'query'],
        },
    },
    { name: 'get_symbol', category: 'retrieval', purpose: 'fetch one exact symbol snippet', permission: 'read-only', compression_level: 'internal', description: 'Get the exact source code snippet for a symbol.', inputSchema: symbolSchema },
    {
        name: 'get_file_slice',
        category: 'retrieval',
        purpose: 'read a bounded line range',
        permission: 'read-only',
        compression_level: 'internal',
        description: 'Read a bounded line range from a file.',
        inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' }, file_path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' }, max_tokens: { type: 'number' } },
            required: ['path', 'file_path', 'start_line', 'end_line'],
        },
    },
    {
        name: 'get_file_context',
        category: 'retrieval',
        purpose: 'requested file plus direct internal dependencies',
        permission: 'read-only',
        compression_level: 'internal',
        description: 'Return one requested file plus its resolved direct internal dependencies under a token budget.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                file_path: { type: 'string' },
                max_tokens: { type: 'number' },
                dependency_limit: { type: 'number' },
            },
            required: ['path', 'file_path'],
        },
    },
    { name: 'file_outline', category: 'retrieval', purpose: 'summarize one file outline', permission: 'read-only', compression_level: 'internal', description: 'Get a summary outline of symbols in a specific file.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, file_path: { type: 'string' } }, required: ['path', 'file_path'] } },
    { name: 'repo_map', category: 'map', purpose: 'high-level repo structure', permission: 'read-only', compression_level: 'internal', description: 'Get a high-level file and symbol outline of the entire repository.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, format: { type: 'string', enum: ['text', 'ocap', 'auto'] } }, required: ['path'] } },
    { name: 'route_map', category: 'map', purpose: 'framework route map', permission: 'read-only', compression_level: 'internal', description: 'Locate Next.js app routes, pages, and HTTP handlers across the repository.', inputSchema: pathSchema },
    { name: 'test_map', category: 'map', purpose: 'test file and suite map', permission: 'read-only', compression_level: 'internal', description: 'Locate test files and basic test structures across the repository.', inputSchema: pathSchema },
    { name: 'config_map', category: 'map', purpose: 'important project config map', permission: 'read-only', compression_level: 'internal', description: 'Locate key configuration files.', inputSchema: pathSchema },
    { name: 'spaghetti_report', category: 'quality', purpose: 'No Spaghett health report only', permission: 'read-only', compression_level: 'internal', description: 'Code-health analysis over the indexed graph. Does not edit code.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, god_object_threshold: { type: 'number' }, long_file_threshold: { type: 'number' }, format: { type: 'string', enum: ['text', 'ocap', 'auto'] } }, required: ['path'] } },
    { name: 'write_repair_handoff', category: 'quality', purpose: 'write No Spaghett advisory handoff markdown only', permission: 'read-only', compression_level: 'internal', description: 'Write an advisory repair handoff Markdown file. It never edits code.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, intent: { type: 'string', enum: ['dead_code', 'cyclic_deps', 'god_object', 'long_file', 'rename', 'delete', 'general'] }, target: { type: 'string' }, destructive: { type: 'boolean' }, output_path: { type: 'string' } }, required: ['path'] } },
    {
        name: 'repair_plan',
        category: 'quality',
        purpose: 'backward-compatible alias for write_repair_handoff (deprecated in v0.2)',
        permission: 'read-only',
        compression_level: 'internal',
        description: 'DEPRECATED v0.2: alias for write_repair_handoff. Writes Markdown only; never edits code. Prefer write_repair_handoff directly.',
        inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' }, intent: { type: 'string', enum: ['dead_code', 'cyclic_deps', 'god_object', 'long_file', 'rename', 'delete', 'general'] }, target: { type: 'string' }, destructive: { type: 'boolean' }, output_path: { type: 'string' } },
            required: ['path'],
        },
    },
    { name: 'dependency_map', category: 'graph', purpose: 'symbol dependency graph', permission: 'read-only', compression_level: 'internal', description: 'Analyze dependencies of a specific symbol in the AST graph.', inputSchema: symbolSchema },
    { name: 'blast_radius', category: 'graph', purpose: 'symbol dependent impact map', permission: 'read-only', compression_level: 'internal', description: 'Calculate the blast radius for a specific symbol.', inputSchema: symbolSchema },
    { name: 'dead_code_scan', category: 'quality', purpose: 'scan dead symbol candidates', permission: 'read-only', compression_level: 'internal', description: 'Scan the AST graph for unreachable or dead code symbols.', inputSchema: pathSchema },
    { name: 'blindspot_report', category: 'quality', purpose: 'parser and visibility blindspots', permission: 'read-only', compression_level: 'internal', description: 'Group blindspots by directory and parser error type.', inputSchema: pathSchema },
    { name: 'get_context_bundle', category: 'retrieval', purpose: 'bounded symbol context bundle', permission: 'read-only', compression_level: 'internal', description: 'Retrieve a bounded contextual package around a symbol.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, symbol_name: { type: 'string' }, max_tokens: { type: 'number' }, format: { type: 'string', enum: ['text', 'ocap', 'auto'] } }, required: ['path', 'symbol_name'] } },
    { name: 'check_rename_safe', category: 'safety', purpose: 'rename collision and dependency check', permission: 'agent', compression_level: 'internal', description: 'Checks for potential collisions and dependencies before renaming a symbol.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, current_name: { type: 'string' }, new_name: { type: 'string' } }, required: ['path', 'current_name', 'new_name'] } },
    { name: 'plan_turn', category: 'planning', purpose: 'opening-move diagnostic router', permission: 'agent', compression_level: 'internal', description: 'Opening-move router for any task.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, intent: { type: 'string', enum: ['explore', 'audit'] } }, required: ['path', 'intent'] } },
    { name: 'find_references', category: 'graph', purpose: 'symbol reference search', permission: 'read-only', compression_level: 'internal', description: 'Find all files that depend on or reference a given symbol.', inputSchema: symbolSchema },
    { name: 'check_delete_safe', category: 'safety', purpose: 'delete safety evidence', permission: 'agent', compression_level: 'internal', description: 'Verify if a symbol can be safely deleted.', inputSchema: symbolSchema },
    { name: 'get_hotspots', category: 'quality', purpose: 'top high-risk symbols', permission: 'read-only', compression_level: 'internal', description: 'Top-N high-risk symbols ranked by importance.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, limit: { type: 'number' } }, required: ['path'] } },
    { name: 'get_session_stats', category: 'telemetry', purpose: 'estimated token footprint stats', permission: 'read-only', compression_level: 'debug', description: 'Reports estimated tokens saved by using OmniCode tools.', inputSchema: pathSchema },
    { name: 'token_savings_stats', category: 'telemetry', purpose: 'runtime token saving and artifact spillover stats', permission: 'read-only', compression_level: 'internal', description: 'Reports session token savings, suppressed oversized output, artifact counts, and output budget config.', inputSchema: pathSchema },
    { name: 'runtime_telemetry', category: 'telemetry', purpose: 'host and runtime diagnostics', permission: 'read-only', compression_level: 'debug', description: 'Fetch host and runtime diagnostics.', inputSchema: pathSchema },
    { name: 'get_churn_rate', category: 'git', purpose: 'symbol file churn risk', permission: 'read-only', compression_level: 'internal', description: "Track maintenance risk with git history.", inputSchema: symbolSchema },
    { name: 'get_call_hierarchy', category: 'graph', purpose: 'caller/callee traversal', permission: 'read-only', compression_level: 'internal', description: 'Traverse caller/callee paths.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, symbol_name: { type: 'string' }, max_depth: { type: 'number' } }, required: ['path', 'symbol_name'] } },
    { name: 'benchmark', category: 'benchmark', purpose: 'token burn proof for one repo', permission: 'read-only', compression_level: 'internal', description: 'Run benchmark v2 for token burn proof.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, max_files: { type: 'number' }, max_bytes: { type: 'number' }, max_scan_ms: { type: 'number' }, query: { type: 'string' }, write: { type: 'boolean' } }, required: ['path'] } },
    { name: 'clone_and_index', category: 'index', purpose: 'clone public GitHub repo and index it', permission: 'agent', compression_level: 'internal', description: 'Safely shallow-clone a public GitHub HTTPS repo into the OmniCode clone cache and index it.', inputSchema: { type: 'object', properties: { repo_url: { type: 'string' }, branch: { type: 'string' }, fresh: { type: 'boolean' }, max_bytes: { type: 'number' }, timeout_ms: { type: 'number' }, max_files: { type: 'number' } }, required: ['repo_url'] } },
    { name: 'language_support', category: 'quality', purpose: 'native/fallback parser coverage', permission: 'read-only', compression_level: 'internal', description: 'Show currently supported language parser coverage.', inputSchema: pathSchema },
    { name: 'resolve_all', category: 'quality', purpose: 'Zero Unknown Files resolution ledger + reports', permission: 'agent', compression_level: 'internal', description: 'Classify and resolve every file into a resolution state with proof; writes RESOLUTION_REPORT.md, resolution.json, unresolved.ndjson, resolver_gaps.md, artifact_manifest.json, source_coverage.json.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, reindex: { type: 'boolean' }, write: { type: 'boolean' } }, required: ['path'] } },
    { name: 'blindspot_explorer', category: 'quality', purpose: 'explain blindspots + top unresolved references', permission: 'read-only', compression_level: 'internal', description: 'List blindspot classes and the top unresolved import references with honest per-file rate and per-reference explanations of why each is unresolved.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, top: { type: 'number' }, explain: { type: 'boolean' } }, required: ['path'] } },
    { name: 'audit_agent_config', category: 'quality', purpose: 'meta-audit of AI client configs and policy files', permission: 'read-only', compression_level: 'internal', description: 'Scan Claude / Codex / Cursor / Windsurf / Copilot / Cline configs and policy files for stale paths, phantom tool mentions, anti-patterns (raw-read, cat, always-read-entire-file), missing policy, and token waste. Pure read-only audit; never edits files.', inputSchema: { type: 'object', properties: { target: { type: 'string', description: 'Optional single file to audit; defaults to all known AI client config locations under the user home.' } } } },
];
exports.PUBLIC_TOOL_NAMES = new Set([
    'health_check',
    'list_tools',
    'get_tool_schema',
    'invoke_tool',
    'session_resume_brief',
    'skill_search',
    'skill_load',
    'skill_pack_for_task',
]);
function getToolMode() {
    const raw = (process.env.OMNICODE_TOOL_MODE || 'compressed').toLowerCase();
    if (raw === 'full' || raw === 'debug' || raw === 'compressed')
        return raw;
    return 'compressed';
}
function getToolDefinition(name) {
    return exports.TOOL_DEFINITIONS.find((tool) => tool.name === name);
}
function getVisibleToolDefinitions(mode = getToolMode()) {
    if (mode === 'compressed')
        return exports.TOOL_DEFINITIONS.filter((tool) => exports.PUBLIC_TOOL_NAMES.has(tool.name));
    return exports.TOOL_DEFINITIONS;
}
function toMcpTool(tool) {
    return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
    };
}
function toCompactCatalog(tool) {
    return {
        name: tool.name,
        category: tool.category,
        compression_level: tool.compression_level,
        purpose: tool.purpose,
        permission_required: tool.permission,
    };
}
