#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const index_project_1 = require("./tools/index_project");
const search_symbols_1 = require("./tools/search_symbols");
const get_symbol_1 = require("./tools/get_symbol");
const get_file_slice_1 = require("./tools/get_file_slice");
const get_file_context_1 = require("./tools/get_file_context");
const file_outline_1 = require("./tools/file_outline");
const repo_map_1 = require("./tools/repo_map");
const dependency_map_1 = require("./tools/dependency_map");
const blast_radius_1 = require("./tools/blast_radius");
const dead_code_scan_1 = require("./tools/dead_code_scan");
const blindspot_report_1 = require("./tools/blindspot_report");
const resolve_all_1 = require("./tools/resolve_all");
const blindspot_explorer_1 = require("./tools/blindspot_explorer");
const get_context_bundle_1 = require("./tools/get_context_bundle");
const plan_turn_1 = require("./tools/plan_turn");
const check_rename_safe_1 = require("./tools/check_rename_safe");
const find_references_1 = require("./tools/find_references");
const check_delete_safe_1 = require("./tools/check_delete_safe");
const get_hotspots_1 = require("./tools/get_hotspots");
const get_churn_rate_1 = require("./tools/get_churn_rate");
const get_call_hierarchy_1 = require("./tools/get_call_hierarchy");
const language_support_1 = require("./tools/language_support");
const route_map_1 = require("./tools/route_map");
const test_map_1 = require("./tools/test_map");
const config_map_1 = require("./tools/config_map");
const runtime_telemetry_1 = require("./tools/runtime_telemetry");
const benchmark_1 = require("./tools/benchmark");
const clone_and_index_1 = require("./tools/clone_and_index");
const spaghetti_report_1 = require("./tools/spaghetti_report");
const repair_plan_1 = require("./tools/repair_plan");
const session_resume_brief_1 = require("./tools/session_resume_brief");
const skill_index_1 = require("./skills/skill_index");
const audit_agent_config_1 = require("./tools/audit_agent_config");
const telemetry_1 = require("./telemetry");
const output_budget_1 = require("./engine/output_budget");
const chokidar_1 = __importDefault(require("chokidar"));
const db_1 = require("./store/db");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const rbac_1 = require("./security/rbac");
const sandbox_1 = require("./security/sandbox");
const audit_1 = require("./security/audit");
const tool_registry_1 = require("./tool_registry");
const watchers = new Map();
const server = new index_js_1.Server({
    name: "omnicode-mcp",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Register tools (stub for M1)
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "health_check",
                description: "Checks if the OmniCode MCP server is running and returns basic status.",
                inputSchema: {
                    type: "object",
                    properties: {},
                    required: [],
                },
            },
            {
                name: "index_project",
                description: "Index or refresh the approved repository.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: {
                            type: "string",
                            description: "Absolute path to the repository to index",
                        },
                        max_files: { type: "number", description: "Stress guard: maximum source files to index" },
                        max_bytes: { type: "number", description: "Stress guard: maximum source bytes to index" },
                        max_scan_ms: { type: "number", description: "Stress guard: maximum scan time in milliseconds" },
                        no_watch: { type: "boolean", description: "Skip chokidar watcher after indexing" },
                        force: { type: "boolean", description: "Re-parse every file even if unchanged (use after a parser/engine upgrade)" }
                    },
                    required: ["path"],
                },
            },
            {
                name: "search_symbols",
                description: "Search for symbols across the repository. Uses fuzzy search under the hood to ensure recall even with structural changes or variable name typos.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        query: { type: "string" },
                        max_results: { type: "number", description: "Cap the search results per request to save context window tokens" },
                        fuzzy_threshold: { type: "number", description: "Search tolerance, defaults to 0.4. Float up to 1.0 (highly tolerant)" },
                    },
                    required: ["path", "query"],
                },
            },
            {
                name: "get_symbol",
                description: "Get the exact source code snippet for a symbol.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        symbol_name: { type: "string" },
                    },
                    required: ["path", "symbol_name"],
                },
            },
            {
                name: "get_file_slice",
                description: "Read a bounded line range from a file.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        file_path: { type: "string" },
                        start_line: { type: "number" },
                        end_line: { type: "number" },
                        max_tokens: { type: "number", description: "Budget constraint, defaults to 4000" }
                    },
                    required: ["path", "file_path", "start_line", "end_line"],
                },
            },
            {
                name: "file_outline",
                description: "Get a summary outline of symbols in a specific file.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        file_path: { type: "string" },
                    },
                    required: ["path", "file_path"],
                },
            },
            {
                name: "repo_map",
                description: "Get a high-level file and symbol outline of the entire repository.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                    },
                    required: ["path"],
                },
            },
            {
                name: "route_map",
                description: "Locate Next.js app routes, pages, and HTTP handlers across the repository.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                    },
                    required: ["path"],
                },
            },
            {
                name: "test_map",
                description: "Locate test files and basic test structures across the repository.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                    },
                    required: ["path"],
                },
            },
            {
                name: "config_map",
                description: "Locate key configuration files (package.json, Next, Vite, ESLint, etc.).",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                    },
                    required: ["path"],
                },
            },
            {
                name: "spaghetti_report",
                description: "Code-health analysis (No Spaghett) over the indexed graph: circular dependencies, god objects, long files, dead code, and a 0-100 health score. No re-parsing — uses the existing index.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        god_object_threshold: { type: "number", description: "Incoming-dependency count above which a file is a god object (default 20)." },
                        long_file_threshold: { type: "number", description: "Line count above which a file is flagged long (default 500)." },
                    },
                    required: ["path"],
                },
            },
            {
                name: "dependency_map",
                description: "Analyze dependencies of a specific symbol in the AST graph.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        symbol_name: { type: "string" },
                    },
                    required: ["path", "symbol_name"],
                },
            },
            {
                name: "blast_radius",
                description: "Calculate the blast radius (dependents) for a specific symbol to evaluate modification safety.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        symbol_name: { type: "string" },
                    },
                    required: ["path", "symbol_name"],
                },
            },
            {
                name: "dead_code_scan",
                description: "Scan the AST graph for unreachable or dead code symbols.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                    },
                    required: ["path"],
                },
            },
            {
                name: "blindspot_report",
                description: "Group blindspots by directory and parser error type.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                    },
                    required: ["path"],
                },
            },
            {
                name: "get_context_bundle",
                description: "Retrieve a bounded contextual package around a symbol including its source, what it calls (callees), and who calls it (callers) in a single request.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string", description: "Absolute path to repository root" },
                        symbol_name: { type: "string", description: "Name of the symbol" },
                        max_tokens: { type: "number", description: "Budget constraint, defaults to 4000" },
                    },
                    required: ["path", "symbol_name"],
                },
            },
            {
                name: "check_rename_safe",
                description: "Checks for potential collisions and lists dependencies before renaming a symbol.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        current_name: { type: "string" },
                        new_name: { type: "string" },
                    },
                    required: ["path", "current_name", "new_name"],
                },
            },
            {
                name: "plan_turn",
                description: "Opening-move router for any task. Assembles the best diagnostic info, saving the agent from piecing multiple tool calls together.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        intent: { type: "string", enum: ["explore", "audit"], description: "The agent's intent for the turn" },
                    },
                    required: ["path", "intent"],
                },
            },
            {
                name: "find_references",
                description: "Find all files that depend on or reference a given symbol.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        symbol_name: { type: "string" },
                    },
                    required: ["path", "symbol_name"],
                },
            },
            {
                name: "check_delete_safe",
                description: "Verify if a symbol can be safely deleted, detailing incoming dependencies.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        symbol_name: { type: "string" },
                    },
                    required: ["path", "symbol_name"],
                },
            },
            {
                name: "get_hotspots",
                description: "Top-N high-risk symbols ranked by importance and structural footprint.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        limit: { type: "number" },
                    },
                    required: ["path"],
                },
            },
            {
                name: "get_session_stats",
                description: "Reports the tokens saved and processing footprint reduced by using OmniCode tools instead of reading raw files.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                    },
                    required: ["path"],
                },
            },
            {
                name: "runtime_telemetry",
                description: "Fetch host and runtime diagnostics like CPU, memory footprint, and operating constraints.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                    },
                    required: ["path"],
                },
            },
            {
                name: "get_churn_rate",
                description: "Cross-references a symbol's file path with 'git log -L' to track maintenance risk.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        symbol_name: { type: "string" },
                    },
                    required: ["path", "symbol_name"],
                },
            },
            {
                name: "get_call_hierarchy",
                description: "Traverse caller/callee paths to map symbol dependencies precisely.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        symbol_name: { type: "string" },
                        max_depth: { type: "number", description: "Depth of call traversal (default 2)" },
                    },
                    required: ["path", "symbol_name"],
                },
            },
            {
                name: "benchmark",
                description: "Run benchmark v2 for token burn proof. Writes .omnicode/BENCHMARK.md and benchmark.json by default.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        max_files: { type: "number" },
                        max_bytes: { type: "number" },
                        max_scan_ms: { type: "number" },
                        query: { type: "string" },
                        write: { type: "boolean" }
                    },
                    required: ["path"],
                },
            },
            {
                name: "clone_and_index",
                description: "Safely shallow-clone a public GitHub HTTPS repo into the OmniCode clone cache and index it. Public repos only in v0.1.",
                inputSchema: {
                    type: "object",
                    properties: {
                        repo_url: { type: "string" },
                        branch: { type: "string" },
                        fresh: { type: "boolean" },
                        max_bytes: { type: "number" },
                        timeout_ms: { type: "number" },
                        max_files: { type: "number" }
                    },
                    required: ["repo_url"],
                },
            },
            {
                name: "language_support",
                description: "Show which programming languages are currently supported by the AST parser.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                    },
                    required: ["path"],
                },
            },
            {
                name: "repair_plan",
                description: "Write a No Spaghett advisory repair handoff Markdown file. It never edits code; it only explains what a separate AI agent or user should inspect before repairs.",
                inputSchema: {
                    type: "object",
                    properties: {
                        path: { type: "string" },
                        intent: { type: "string", enum: ["dead_code", "cyclic_deps", "god_object", "long_file", "rename", "delete", "general"] },
                        target: { type: "string" },
                        destructive: { type: "boolean" },
                        output_path: { type: "string", description: "Optional repo-relative Markdown output path. Defaults to .omnicode/NO_SPAGHETT_REPAIR_HANDOFF.md" }
                    },
                    required: ["path"],
                },
            },
        ],
    };
});
// Trust Layer v1: mode-aware exposure replaces the legacy all-schema list above.
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: (0, tool_registry_1.getVisibleToolDefinitions)((0, tool_registry_1.getToolMode)()).map(tool_registry_1.toMcpTool),
    };
});
function currentRole() {
    const validRoles = ['admin', 'read-only', 'agent'];
    const envRole = process.env.OMNICODE_ROLE;
    return envRole && validRoles.includes(envRole) ? envRole : 'read-only';
}
function currentUser() {
    return process.env.OMNICODE_USER || 'mcp-client';
}
server.setRequestHandler(types_js_1.CallToolRequestSchema, (async (request) => {
    const toolName = request.params.name;
    const args = request.params.arguments || {};
    // Role is derived from the server's own configuration (set by whoever launches
    // the MCP), NOT hardcoded and NOT taken from the request. Defaults to the
    // least-privileged role so an unconfigured deployment cannot mutate or index.
    const role = currentRole();
    const user = currentUser();
    try {
        if (toolName === 'invoke_tool') {
            if (!(0, rbac_1.checkPermission)(role, 'invoke_tool')) {
                throw new Error(`Permission denied: Role '${role}' cannot access tool 'invoke_tool'`);
            }
            const targetName = String(args.tool_name || '');
            if (!targetName || targetName === 'invoke_tool') {
                throw new Error('invoke_tool requires a non-recursive tool_name');
            }
            if (!(0, tool_registry_1.getToolDefinition)(targetName)) {
                throw new Error(`Tool not found: ${targetName}`);
            }
            // v0.2 audit trail: record the gateway caller, target tool, and a stable
            // hash of the inner tool_input so two invocations with the same payload
            // are correlatable in the audit log.
            return await executeToolWithSecurity(targetName, args.tool_input || {}, request, role, user, { caller: 'invoke_tool', repo: args.tool_input?.path });
        }
        return await executeToolWithSecurity(toolName, args, request, role, user);
    }
    catch (err) {
        (0, audit_1.logAudit)(args.path, user, role, toolName, 'error', err.message, { argsHash: (0, audit_1.hashAuditArgs)(args), caller: undefined, repo: args.path });
        return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
}));
async function executeToolWithSecurity(toolName, args, request, role = currentRole(), user = currentUser(), auditExtras = {}) {
    if (!(0, rbac_1.checkPermission)(role, toolName)) {
        throw new Error(`Permission denied: Role '${role}' cannot access tool '${toolName}'`);
    }
    const repoPath = args.path;
    if (repoPath) {
        (0, sandbox_1.enforceSandbox)(repoPath, args);
    }
    const rawResult = await handleTool(toolName, args, request);
    const finalResult = (0, output_budget_1.applyOutputBudget)(toolName, repoPath, rawResult);
    // Live session telemetry + status heartbeat (stderr → shows in the client's
    // MCP server logs, the universal "active / work done / tokens saved" indicator).
    const outText = (finalResult.content && finalResult.content[0] && finalResult.content[0].text) || '';
    (0, telemetry_1.recordCall)(toolName, outText, !!finalResult.isError);
    console.error((0, telemetry_1.statusLine)());
    // v0.2 audit trail: every tool execution is logged with a stable args_hash so
    // the audit table can be diffed and queried by payload signature. Caller/repo
    // propagate from invoke_tool for hidden-tool calls.
    (0, audit_1.logAudit)(repoPath, user, role, toolName, finalResult.isError ? 'error' : 'success', finalResult.isError ? outText : 'Tool execution complete', {
        argsHash: (0, audit_1.hashAuditArgs)(args),
        caller: auditExtras.caller,
        repo: auditExtras.repo || repoPath,
    });
    return finalResult;
}
async function handleTool(toolName, args, request) {
    if (toolName === "health_check") {
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ status: "healthy", version: "0.1.0", rbac: "enforcing sandbox constraints" }, null, 2),
                },
            ],
        };
    }
    if (toolName === "list_tools") {
        const catalog = tool_registry_1.TOOL_DEFINITIONS.map(tool_registry_1.toCompactCatalog);
        return {
            content: [{ type: "text", text: JSON.stringify({ mode: (0, tool_registry_1.getToolMode)(), tools: catalog }, null, 2) }],
        };
    }
    if (toolName === "get_tool_schema") {
        const requested = String(args.tool_name || '');
        const tool = (0, tool_registry_1.getToolDefinition)(requested);
        if (!tool) {
            return { content: [{ type: "text", text: `Tool not found: ${requested}` }], isError: true };
        }
        const role = currentRole();
        if (!(0, rbac_1.checkPermission)(role, requested)) {
            return { content: [{ type: "text", text: `Permission denied: Role '${role}' cannot access schema for '${requested}'` }], isError: true };
        }
        return {
            content: [{ type: "text", text: JSON.stringify((0, tool_registry_1.toMcpTool)(tool), null, 2) }],
        };
    }
    if (toolName === "session_resume_brief") {
        try {
            const result = await (0, session_resume_brief_1.sessionResumeBrief)(args.path);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "index_project") {
        const repoPath = args.path;
        try {
            const progressToken = request.params._meta?.progressToken || "index_progress";
            const result = await (0, index_project_1.indexProject)(repoPath, (current, total) => {
                // Send progress notification to client
                server.notification({
                    method: "notifications/progress",
                    params: {
                        progressToken,
                        progress: current,
                        total,
                    }
                }).catch((err) => {
                    // Ignore notification errors
                });
            }, { maxFiles: args.max_files, maxBytes: args.max_bytes, maxScanMs: args.max_scan_ms, force: args.force });
            const watcherLimit = Number(process.env.OMNICODE_WATCHER_MAX_FILES || 5000);
            const shouldWatch = !args.no_watch && result.scannedFiles <= watcherLimit && !result.maxFilesHit && !result.timeLimitHit;
            if (shouldWatch && !watchers.has(repoPath)) {
                const watcher = chokidar_1.default.watch(repoPath, {
                    ignored: [
                        /(^|[\/\\])\../, // ignore dotfiles
                        /node_modules/,
                        /dist/,
                        /build/,
                        /\.next/
                    ],
                    persistent: true,
                    ignoreInitial: true
                });
                // Use a small delay/debouncer for file changes
                watcher
                    .on('add', async (filePath) => {
                    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
                        await (0, index_project_1.indexSingleFile)(repoPath, filePath).catch(console.error);
                    }
                })
                    .on('change', async (filePath) => {
                    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
                        await (0, index_project_1.indexSingleFile)(repoPath, filePath).catch(console.error);
                    }
                })
                    .on('unlink', async (filePath) => {
                    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
                        await (0, index_project_1.indexSingleFile)(repoPath, filePath).catch(console.error);
                    }
                });
                watchers.set(repoPath, watcher);
            }
            const watcherStatus = shouldWatch
                ? 'File watcher activated for incremental re-indexing.'
                : args.no_watch
                    ? 'File watcher skipped by request.'
                    : 'File watcher skipped by safety limits.';
            return {
                content: [
                    {
                        type: "text",
                        text: `Index complete.\n\nFiles scanned: ${result.scannedFiles}\nNewly indexed: ${result.newlyIndexed}\nTotal files in index: ${result.totalIndexedFiles}\nSymbols extracted: ${result.symbolsExtracted}\nBlindspots detected: ${result.blindspotsDetected}\n\n${watcherStatus}`,
                    },
                ],
            };
        }
        catch (e) {
            return {
                content: [
                    { type: "text", text: `Error indexing: ${e.message}` }
                ],
                isError: true,
            };
        }
    }
    // ── SkillVault (Phase One) ───────────────────────────────────────────
    // Indexed, on-demand skill retrieval. Read the prebuilt index, search it
    // for the query, optionally return the full body of a single skill.
    // Same philosophy as OmniCode itself: don't dump every skill into agent
    // context, index once, retrieve exact relevant skills.
    if (toolName === "skill_search") {
        try {
            const query = String(args.query || "");
            const indexPath = args.index_path
                ? path_1.default.resolve(String(args.index_path))
                : path_1.default.resolve(".omnicode/skill-index.json");
            const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
            if (!fs_1.default.existsSync(indexPath)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Skill index not found at ${indexPath}. Run \`omnicode skill-index <skillsDir>\` first.`,
                        },
                    ],
                    isError: true,
                };
            }
            const idx = (0, skill_index_1.readSkillIndexFile)(indexPath);
            const hits = (0, skill_index_1.searchSkillIndex)(idx, query, limit);
            const out = {
                query,
                index_built_at: idx.built_at,
                total_skills_in_index: idx.total_skills,
                hits: hits.map((h) => ({
                    name: h.name,
                    description: h.description,
                    origin: h.origin,
                    rel_path: h.rel_path,
                    score: h.score,
                    matched_tokens: h.matched_tokens,
                })),
            };
            return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `skill_search error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "skill_load") {
        try {
            const skillName = String(args.name || "");
            const indexPath = args.index_path
                ? path_1.default.resolve(String(args.index_path))
                : path_1.default.resolve(".omnicode/skill-index.json");
            if (!fs_1.default.existsSync(indexPath)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Skill index not found at ${indexPath}. Run \`omnicode skill-index <skillsDir>\` first.`,
                        },
                    ],
                    isError: true,
                };
            }
            const idx = (0, skill_index_1.readSkillIndexFile)(indexPath);
            const { meta, body } = (0, skill_index_1.loadSkillBody)(idx, skillName);
            const header = `# ${meta.name}  [${meta.origin}]\n# ${meta.description}\n# folder: ${meta.rel_path}\n# files: ${meta.file_count}\n\n`;
            return { content: [{ type: "text", text: header + body }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `skill_load error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "skill_pack_for_task") {
        try {
            const task = String(args.task || "");
            const indexPath = args.index_path
                ? path_1.default.resolve(String(args.index_path))
                : path_1.default.resolve(".omnicode/skill-index.json");
            const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
            const poolSize = Math.max(limit, Math.min(100, Number(args.pool) || 25));
            if (!fs_1.default.existsSync(indexPath)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Skill index not found at ${indexPath}. Run \`omnicode skill-index <skillsDir>\` first.`,
                        },
                    ],
                    isError: true,
                };
            }
            const idx = (0, skill_index_1.readSkillIndexFile)(indexPath);
            const pack = (0, skill_index_1.buildSkillPack)(idx, task, limit, poolSize);
            return { content: [{ type: "text", text: JSON.stringify(pack, null, 2) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `skill_pack_for_task error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "search_symbols") {
        try {
            const result = await (0, search_symbols_1.searchSymbols)(args.path, args.query, args.max_results, args.fuzzy_threshold, { car: args.car === true, debug: args.debug === true, format: args.format });
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "get_symbol") {
        try {
            const result = await (0, get_symbol_1.getSymbol)(args.path, args.symbol_name);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "get_file_slice") {
        try {
            const result = await (0, get_file_slice_1.getFileSlice)(args.path, args.file_path, args.start_line, args.end_line, args.max_tokens);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "get_file_context") {
        try {
            const result = await (0, get_file_context_1.getFileContext)(args.path, args.file_path, args.max_tokens, args.dependency_limit);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "file_outline") {
        try {
            const result = await (0, file_outline_1.fileOutline)(args.path, args.file_path);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "repo_map") {
        try {
            const result = await (0, repo_map_1.repoMap)(args.path, args.format);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "route_map") {
        try {
            const result = await (0, route_map_1.routeMap)(args.path);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "test_map") {
        try {
            const result = await (0, test_map_1.testMap)(args.path);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "config_map") {
        try {
            const result = await (0, config_map_1.configMap)(args.path);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "spaghetti_report") {
        try {
            const result = await (0, spaghetti_report_1.spaghettiReport)(args.path, args.god_object_threshold, args.long_file_threshold, args.format);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "dependency_map") {
        try {
            const result = await (0, dependency_map_1.dependencyMap)(args.path, args.symbol_name);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "blast_radius") {
        try {
            const result = await (0, blast_radius_1.blastRadius)(args.path, args.symbol_name);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "dead_code_scan") {
        try {
            const result = await (0, dead_code_scan_1.deadCodeScan)(args.path);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "blindspot_report") {
        try {
            const result = await (0, blindspot_report_1.blindspotReport)(args.path);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "blindspot_explorer") {
        try {
            const result = await (0, blindspot_explorer_1.blindspotExplorer)(args.path, { top: args.top, explain: args.explain });
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "resolve_all") {
        try {
            const result = await (0, resolve_all_1.resolveAll)(args.path, { reindex: args.reindex, write: args.write });
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "audit_agent_config") {
        try {
            const result = await (0, audit_agent_config_1.auditAgentConfig)({ target: args.target });
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "get_context_bundle") {
        try {
            const result = await (0, get_context_bundle_1.getContextBundle)(args.path, args.symbol_name, args.max_tokens, args.format);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "check_rename_safe") {
        try {
            const result = await (0, check_rename_safe_1.checkRenameSafe)(args.path, args.current_name, args.new_name);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "plan_turn") {
        try {
            const result = await (0, plan_turn_1.planTurn)(args.path, args.intent);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "find_references") {
        try {
            const result = await (0, find_references_1.findReferences)(args.path, args.symbol_name);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "check_delete_safe") {
        try {
            const result = await (0, check_delete_safe_1.checkDeleteSafe)(args.path, args.symbol_name);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "get_hotspots") {
        try {
            const result = await (0, get_hotspots_1.getHotspots)(args.path, args.limit || 10);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "get_churn_rate") {
        try {
            const result = await (0, get_churn_rate_1.getChurnRate)(args.path, args.symbol_name);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "get_call_hierarchy") {
        try {
            const result = await (0, get_call_hierarchy_1.getCallHierarchy)(args.path, args.symbol_name, args.max_depth);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "benchmark") {
        try {
            const result = await (0, benchmark_1.benchmarkRepo)(args.path, {
                max_files: args.max_files,
                max_bytes: args.max_bytes,
                max_scan_ms: args.max_scan_ms,
                query: args.query,
                write: args.write !== false
            });
            return { content: [{ type: "text", text: (0, benchmark_1.renderBenchmarkMarkdown)(result) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "clone_and_index") {
        try {
            const result = await (0, clone_and_index_1.cloneAndIndex)(args.repo_url, {
                branch: args.branch,
                fresh: !!args.fresh,
                max_bytes: args.max_bytes,
                timeout_ms: args.timeout_ms,
                max_files: args.max_files
            });
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "language_support") {
        try {
            const result = await (0, language_support_1.languageSupport)(args.path);
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "repair_plan" || toolName === "write_repair_handoff") {
        try {
            const result = await (0, repair_plan_1.repairPlan)(args.path, {
                intent: args.intent,
                target: args.target,
                destructive: args.destructive,
                output_path: args.output_path
            });
            return { content: [{ type: "text", text: result.result }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "get_session_stats" || toolName === "token_savings_stats") {
        try {
            const db = (0, db_1.initDb)(args.path);
            const stats = (0, db_1.getIndexStats)(db);
            const files = db.prepare(`SELECT COALESCE(SUM(size), 0) AS bytes FROM files`).get();
            const symbols = db.prepare(`SELECT COALESCE(SUM(LENGTH(snippet)), 0) AS bytes FROM symbols`).get();
            const session = (0, telemetry_1.getSessionStats)();
            const budget = (0, output_budget_1.outputBudgetConfig)();
            const rawTokens = Math.round((files.bytes || 0) / 4);
            const symbolTokens = Math.round((symbols.bytes || 0) / 4);
            const reduction = rawTokens > 0 ? Math.max(0, 100 - (symbolTokens / rawTokens) * 100) : 0;
            const text = `OmniCode Token Savings Stats:\n\n` +
                `- Files indexed: ${stats.files}\n` +
                `- Symbols indexed: ${stats.symbols}\n` +
                `- Graph edges resolved: ${stats.edges}\n` +
                `- Blindspots recorded: ${stats.blindspots}\n` +
                `- Latest index timestamp: ${stats.indexed_at || "Never indexed"}\n` +
                `- Estimated raw file tokens: ${rawTokens}\n` +
                `- Estimated indexed symbol tokens: ${symbolTokens}\n` +
                `- Estimated retrieval payload reduction: ${reduction.toFixed(1)}%\n\n` +
                `Live MCP session:\n` +
                `- Tool calls: ${session.calls}\n` +
                `- Errors: ${session.errors}\n` +
                `- Tokens returned: ${session.tokensReturned}\n` +
                `- Estimated raw-read tokens avoided: ${session.tokensSaved} (${session.tokensSavedHuman})\n` +
                `- Oversized output tokens suppressed: ${session.tokensSuppressed} (${session.tokensSuppressedHuman})\n` +
                `- Artifact spill count: ${session.artifactCount}\n` +
                `- Artifact bytes written: ${session.artifactBytesWritten}\n` +
                `- Output budget mode: ${budget.mode}\n` +
                `- Output budget limit: ${budget.max_response_tokens} tokens\n\n` +
                `Interpretation: raw-read avoidance is a conservative estimate; suppressed tokens are measured against actual tool output moved to local artifacts.`;
            return { content: [{ type: "text", text }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    if (toolName === "runtime_telemetry") {
        try {
            const result = await (0, runtime_telemetry_1.runtimeTelemetry)(args.path);
            const s = (0, telemetry_1.getSessionStats)();
            const live = `\nLive Session:\n  ${(0, telemetry_1.statusLine)()}\n  Calls: ${s.calls} (errors ${s.errors}) · Tokens returned: ${s.tokensReturned} · Tokens saved (est): ${s.tokensSavedHuman}\n`;
            return { content: [{ type: "text", text: result.result + live }] };
        }
        catch (e) {
            return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
        }
    }
    return {
        content: [
            {
                type: "text",
                text: `Tool not found: ${toolName}`,
            },
        ],
        isError: true,
    };
}
async function run() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error("OmniCode MCP server running on stdio");
}
run().catch((error) => {
    console.error("OmniCode Server Error:", error);
    process.exit(1);
});
