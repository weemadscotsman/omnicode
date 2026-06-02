#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { indexProject, indexSingleFile } from "./tools/index_project";
import { searchSymbols } from "./tools/search_symbols";
import { getSymbol } from "./tools/get_symbol";
import { getFileSlice } from "./tools/get_file_slice";
import { getFileContext } from "./tools/get_file_context";
import { fileOutline } from "./tools/file_outline";
import { repoMap } from "./tools/repo_map";
import { dependencyMap } from "./tools/dependency_map";
import { blastRadius } from "./tools/blast_radius";
import { deadCodeScan } from "./tools/dead_code_scan";
import { blindspotReport } from "./tools/blindspot_report";
import { resolveAll } from "./tools/resolve_all";
import { blindspotExplorer } from "./tools/blindspot_explorer";
import { getContextBundle } from "./tools/get_context_bundle";
import { planTurn } from "./tools/plan_turn";
import { checkRenameSafe } from "./tools/check_rename_safe";
import { findReferences } from "./tools/find_references";
import { checkDeleteSafe } from "./tools/check_delete_safe";
import { getHotspots } from "./tools/get_hotspots";
import { getChurnRate } from "./tools/get_churn_rate";
import { getCallHierarchy } from "./tools/get_call_hierarchy";
import { languageSupport } from "./tools/language_support";
import { routeMap } from "./tools/route_map";
import { testMap } from "./tools/test_map";
import { configMap } from "./tools/config_map";
import { runtimeTelemetry } from "./tools/runtime_telemetry";
import { benchmarkRepo, renderBenchmarkMarkdown } from "./tools/benchmark";
import { cloneAndIndex } from "./tools/clone_and_index";
import { spaghettiReport } from "./tools/spaghetti_report";
import { repairPlan } from "./tools/repair_plan";
import { sessionResumeBrief } from "./tools/session_resume_brief";
import { readSkillIndexFile, searchSkillIndex, loadSkillBody, buildSkillPack } from "./skills/skill_index";
import { auditAgentConfig } from "./tools/audit_agent_config";
import { recordCall, statusLine, getSessionStats } from "./telemetry";
import { applyOutputBudget, outputBudgetConfig } from "./engine/output_budget";
import chokidar, { FSWatcher } from "chokidar";
import { initDb, getIndexStats } from "./store/db";
import path from "path";
import fs from "fs";
import { checkPermission, Role } from "./security/rbac";
import { enforceSandbox } from "./security/sandbox";
import { logAudit, hashAuditArgs } from "./security/audit";
import {
  getToolDefinition,
  getToolMode,
  getVisibleToolDefinitions,
  toCompactCatalog,
  toMcpTool,
  TOOL_DEFINITIONS,
} from "./tool_registry";

const watchers = new Map<string, FSWatcher>();

const server = new Server(
  {
    name: "omnicode-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools (stub for M1)
server.setRequestHandler(ListToolsRequestSchema, async () => {
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
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: getVisibleToolDefinitions(getToolMode()).map(toMcpTool),
  };
});

function currentRole(): Role {
  const validRoles: Role[] = ['admin', 'read-only', 'agent'];
  const envRole = process.env.OMNICODE_ROLE as Role | undefined;
  return envRole && validRoles.includes(envRole) ? envRole : 'read-only';
}

function currentUser(): string {
  return process.env.OMNICODE_USER || 'mcp-client';
}

server.setRequestHandler(CallToolRequestSchema, (async (request: any): Promise<any> => {
  const toolName = request.params.name;
  const args = request.params.arguments || {};
  // Role is derived from the server's own configuration (set by whoever launches
  // the MCP), NOT hardcoded and NOT taken from the request. Defaults to the
  // least-privileged role so an unconfigured deployment cannot mutate or index.
  const role = currentRole();
  const user = currentUser();

  try {
    if (toolName === 'invoke_tool') {
      if (!checkPermission(role, 'invoke_tool')) {
        throw new Error(`Permission denied: Role '${role}' cannot access tool 'invoke_tool'`);
      }
      const targetName = String(args.tool_name || '');
      if (!targetName || targetName === 'invoke_tool') {
        throw new Error('invoke_tool requires a non-recursive tool_name');
      }
      if (!getToolDefinition(targetName)) {
        throw new Error(`Tool not found: ${targetName}`);
      }
      // v0.2 audit trail: record the gateway caller, target tool, and a stable
      // hash of the inner tool_input so two invocations with the same payload
      // are correlatable in the audit log.
      return await executeToolWithSecurity(
        targetName,
        args.tool_input || {},
        request,
        role,
        user,
        { caller: 'invoke_tool', repo: (args.tool_input as any)?.path }
      );
    }

    return await executeToolWithSecurity(toolName, args, request, role, user);
  } catch (err: any) {
    logAudit(
      args.path as string,
      user,
      role,
      toolName,
      'error',
      err.message,
      { argsHash: hashAuditArgs(args), caller: undefined, repo: args.path as string }
    );
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
}) as any);

async function executeToolWithSecurity(
  toolName: string,
  args: any,
  request: any,
  role = currentRole(),
  user = currentUser(),
  auditExtras: { caller?: string; repo?: string } = {}
): Promise<any> {
  if (!checkPermission(role, toolName)) {
    throw new Error(`Permission denied: Role '${role}' cannot access tool '${toolName}'`);
  }

  const repoPath = args.path as string;
  if (repoPath) {
    enforceSandbox(repoPath, args);
  }

  const rawResult = await handleTool(toolName, args, request);
  const finalResult = applyOutputBudget(toolName, repoPath, rawResult);

  // Live session telemetry + status heartbeat (stderr → shows in the client's
  // MCP server logs, the universal "active / work done / tokens saved" indicator).
  const outText = (finalResult.content && finalResult.content[0] && finalResult.content[0].text) || '';
  recordCall(toolName, outText, !!finalResult.isError);
  console.error(statusLine());

  // v0.2 audit trail: every tool execution is logged with a stable args_hash so
  // the audit table can be diffed and queried by payload signature. Caller/repo
  // propagate from invoke_tool for hidden-tool calls.
  logAudit(
    repoPath,
    user,
    role,
    toolName,
    finalResult.isError ? 'error' : 'success',
    finalResult.isError ? outText : 'Tool execution complete',
    {
      argsHash: hashAuditArgs(args),
      caller: auditExtras.caller,
      repo: auditExtras.repo || repoPath,
    }
  );

  return finalResult;
}

async function handleTool(toolName: string, args: any, request: any): Promise<any> {
  if (toolName === "health_check") {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "healthy", version: "0.1.0", rbac: "enforcing sandbox constraints" }, null, 2),
        },
      ],
    };
  }

  if (toolName === "list_tools") {
    const catalog = TOOL_DEFINITIONS.map(toCompactCatalog);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ mode: getToolMode(), tools: catalog }, null, 2) }],
    };
  }

  if (toolName === "get_tool_schema") {
    const requested = String(args.tool_name || '');
    const tool = getToolDefinition(requested);
    if (!tool) {
      return { content: [{ type: "text" as const, text: `Tool not found: ${requested}` }], isError: true };
    }
    const role = currentRole();
    if (!checkPermission(role, requested)) {
      return { content: [{ type: "text" as const, text: `Permission denied: Role '${role}' cannot access schema for '${requested}'` }], isError: true };
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(toMcpTool(tool), null, 2) }],
    };
  }

  if (toolName === "session_resume_brief") {
    try {
      const result = await sessionResumeBrief(args.path as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "index_project") {
    const repoPath = args.path as string;
    try {
      const progressToken = request.params._meta?.progressToken || "index_progress";
      const result = await indexProject(repoPath, (current, total) => {
        // Send progress notification to client
        server.notification({
          method: "notifications/progress",
          params: {
            progressToken,
            progress: current,
            total,
          }
        }).catch((err: any) => {
          // Ignore notification errors
        });
      }, { maxFiles: args.max_files as number, maxBytes: args.max_bytes as number, maxScanMs: args.max_scan_ms as number, force: args.force as boolean });

      const watcherLimit = Number(process.env.OMNICODE_WATCHER_MAX_FILES || 5000);
      const shouldWatch = !args.no_watch && result.scannedFiles <= watcherLimit && !result.maxFilesHit && !result.timeLimitHit;
      if (shouldWatch && !watchers.has(repoPath)) {
        const watcher = chokidar.watch(repoPath, {
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
          .on('add', async (filePath: string) => {
            if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
              await indexSingleFile(repoPath, filePath).catch(console.error);
            }
          })
          .on('change', async (filePath: string) => {
            if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
              await indexSingleFile(repoPath, filePath).catch(console.error);
            }
          })
          .on('unlink', async (filePath: string) => {
            if (filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js') || filePath.endsWith('.jsx')) {
              await indexSingleFile(repoPath, filePath).catch(console.error);
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
            type: "text" as const,
            text: `Index complete.\n\nFiles scanned: ${result.scannedFiles}\nNewly indexed: ${result.newlyIndexed}\nTotal files in index: ${result.totalIndexedFiles}\nSymbols extracted: ${result.symbolsExtracted}\nBlindspots detected: ${result.blindspotsDetected}\n\n${watcherStatus}`,
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [
          { type: "text" as const, text: `Error indexing: ${e.message}` }
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
        ? path.resolve(String(args.index_path))
        : path.resolve(".omnicode/skill-index.json");
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
      if (!fs.existsSync(indexPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Skill index not found at ${indexPath}. Run \`omnicode skill-index <skillsDir>\` first.`,
            },
          ],
          isError: true,
        };
      }
      const idx = readSkillIndexFile(indexPath);
      const hits = searchSkillIndex(idx, query, limit);
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
      return { content: [{ type: "text" as const, text: JSON.stringify(out, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `skill_search error: ${e.message}` }], isError: true };
    }
  }
  if (toolName === "skill_load") {
    try {
      const skillName = String(args.name || "");
      const indexPath = args.index_path
        ? path.resolve(String(args.index_path))
        : path.resolve(".omnicode/skill-index.json");
      if (!fs.existsSync(indexPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Skill index not found at ${indexPath}. Run \`omnicode skill-index <skillsDir>\` first.`,
            },
          ],
          isError: true,
        };
      }
      const idx = readSkillIndexFile(indexPath);
      const { meta, body } = loadSkillBody(idx, skillName);
      const header = `# ${meta.name}  [${meta.origin}]\n# ${meta.description}\n# folder: ${meta.rel_path}\n# files: ${meta.file_count}\n\n`;
      return { content: [{ type: "text" as const, text: header + body }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `skill_load error: ${e.message}` }], isError: true };
    }
  }
  if (toolName === "skill_pack_for_task") {
    try {
      const task = String(args.task || "");
      const indexPath = args.index_path
        ? path.resolve(String(args.index_path))
        : path.resolve(".omnicode/skill-index.json");
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
      const poolSize = Math.max(limit, Math.min(100, Number(args.pool) || 25));
      if (!fs.existsSync(indexPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Skill index not found at ${indexPath}. Run \`omnicode skill-index <skillsDir>\` first.`,
            },
          ],
          isError: true,
        };
      }
      const idx = readSkillIndexFile(indexPath);
      const pack = buildSkillPack(idx, task, limit, poolSize);
      return { content: [{ type: "text" as const, text: JSON.stringify(pack, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `skill_pack_for_task error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "search_symbols") {
    try {
      const result = await searchSymbols(
        args.path as string,
        args.query as string,
        args.max_results as number,
        args.fuzzy_threshold as number,
        { car: args.car === true, debug: args.debug === true, format: args.format as 'text' | 'ocap' | 'auto' | undefined }
      );
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "get_symbol") {
    try {
      const result = await getSymbol(args.path as string, args.symbol_name as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "get_file_slice") {
    try {
      const result = await getFileSlice(args.path as string, args.file_path as string, args.start_line as number, args.end_line as number, args.max_tokens as number);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "get_file_context") {
    try {
      const result = await getFileContext(args.path as string, args.file_path as string, args.max_tokens as number, args.dependency_limit as number);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "file_outline") {
    try {
      const result = await fileOutline(args.path as string, args.file_path as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "repo_map") {
    try {
      const result = await repoMap(args.path as string, args.format as 'text' | 'ocap' | 'auto' | undefined);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "route_map") {
    try {
      const result = await routeMap(args.path as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "test_map") {
    try {
      const result = await testMap(args.path as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "config_map") {
    try {
      const result = await configMap(args.path as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "spaghetti_report") {
    try {
      const result = await spaghettiReport(
        args.path as string,
        args.god_object_threshold as number,
        args.long_file_threshold as number,
        args.format as 'text' | 'ocap' | 'auto' | undefined
      );
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "dependency_map") {
    try {
      const result = await dependencyMap(args.path as string, args.symbol_name as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "blast_radius") {
    try {
      const result = await blastRadius(args.path as string, args.symbol_name as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "dead_code_scan") {
    try {
      const result = await deadCodeScan(args.path as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "blindspot_report") {
    try {
      const result = await blindspotReport(args.path as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "blindspot_explorer") {
    try {
      const result = await blindspotExplorer(args.path as string, { top: args.top as number, explain: args.explain as boolean });
      return { content: [{ type: "text" as const, text: result.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "resolve_all") {
    try {
      const result = await resolveAll(args.path as string, { reindex: args.reindex as boolean, write: args.write as boolean });
      return { content: [{ type: "text" as const, text: result.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "audit_agent_config") {
    try {
      const result = await auditAgentConfig({ target: args.target as string | undefined });
      return { content: [{ type: "text" as const, text: result.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "get_context_bundle") {
    try {
      const result = await getContextBundle(
        args.path as string,
        args.symbol_name as string,
        args.max_tokens as number,
        args.format as 'text' | 'ocap' | 'auto' | undefined
      );
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "check_rename_safe") {
    try {
      const result = await checkRenameSafe(args.path as string, args.current_name as string, args.new_name as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "plan_turn") {
    try {
      const result = await planTurn(args.path as string, args.intent as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "find_references") {
    try {
      const result = await findReferences(args.path as string, args.symbol_name as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "check_delete_safe") {
    try {
      const result = await checkDeleteSafe(args.path as string, args.symbol_name as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "get_hotspots") {
    try {
      const result = await getHotspots(args.path as string, args.limit as number || 10);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "get_churn_rate") {
    try {
      const result = await getChurnRate(args.path as string, args.symbol_name as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "get_call_hierarchy") {
    try {
      const result = await getCallHierarchy(args.path as string, args.symbol_name as string, args.max_depth as number);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "benchmark") {
    try {
      const result = await benchmarkRepo(args.path as string, {
        max_files: args.max_files as number,
        max_bytes: args.max_bytes as number,
        max_scan_ms: args.max_scan_ms as number,
        query: args.query as string,
        write: args.write !== false
      });
      return { content: [{ type: "text" as const, text: renderBenchmarkMarkdown(result) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "clone_and_index") {
    try {
      const result = await cloneAndIndex(args.repo_url as string, {
        branch: args.branch as string,
        fresh: !!args.fresh,
        max_bytes: args.max_bytes as number,
        timeout_ms: args.timeout_ms as number,
        max_files: args.max_files as number
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "language_support") {
    try {
      const result = await languageSupport(args.path as string);
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "repair_plan" || toolName === "write_repair_handoff") {
    try {
      const result = await repairPlan(args.path as string, {
        intent: args.intent as any,
        target: args.target as string,
        destructive: args.destructive as boolean,
        output_path: args.output_path as string
      });
      return { content: [{ type: "text" as const, text: result!.result }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "get_session_stats" || toolName === "token_savings_stats") {
    try {
      const db = initDb(args.path as string);
      const stats = getIndexStats(db);
      const files = db.prepare(`SELECT COALESCE(SUM(size), 0) AS bytes FROM files`).get() as { bytes: number };
      const symbols = db.prepare(`SELECT COALESCE(SUM(LENGTH(snippet)), 0) AS bytes FROM symbols`).get() as { bytes: number };
      const session = getSessionStats();
      const budget = outputBudgetConfig();
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
      return { content: [{ type: "text" as const, text }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  if (toolName === "runtime_telemetry") {
    try {
      const result = await runtimeTelemetry(args.path as string);
      const s = getSessionStats();
      const live = `\nLive Session:\n  ${statusLine()}\n  Calls: ${s.calls} (errors ${s.errors}) · Tokens returned: ${s.tokensReturned} · Tokens saved (est): ${s.tokensSavedHuman}\n`;
      return { content: [{ type: "text" as const, text: result!.result + live }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
    }
  }

  return {
    content: [
      {
        type: "text" as const,
        text: `Tool not found: ${toolName}`,
      },
    ],
    isError: true,
  };
}

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OmniCode MCP server running on stdio");
}

run().catch((error) => {
  console.error("OmniCode Server Error:", error);
  process.exit(1);
});
