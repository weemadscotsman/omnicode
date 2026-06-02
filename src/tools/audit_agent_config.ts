// ───────────────────────────────────────────────────────────────────────────
// audit_agent_config — proactive win-finding for AI agent configurations
//
// Walks Claude / Codex / Cursor / Windsurf / Copilot / Cline config files
// looking for stale references, phantom tool mentions, anti-patterns
// (e.g. "use cat/Read" without scope), missing policy files, duplicate
// instructions, conflicting instructions, and silent token waste.
//
// This is a meta-audit — it scores the AGENT'S own rules, not the
// indexed source code. Every finding ships with a concrete fix
// suggestion, so the report is a one-shot punch list.
// ───────────────────────────────────────────────────────────────────────────

import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  category: string;
  severity: Severity;
  location: string;
  evidence: string;
  fix: string;
}

export interface AuditOptions {
  target?: string;
  home?: string;
}

interface ScannedFile {
  path: string;
  kind: 'json' | 'toml' | 'markdown' | 'text' | 'missing';
  content: string;
  exists: boolean;
}

const HOME = os.homedir();
const APPDATA = process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');

const KNOWN_TOOL_NAMES = new Set([
  // Claude Code built-ins
  'Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Grep', 'Glob',
  'WebFetch', 'WebSearch', 'TodoWrite', 'Task', 'NotebookEdit',
  // MCP prefixes
  'mcp__omnicode__*', 'mcp__jcodemunch__*',
  // Full OmniCode registry (mirrors src/tool_registry.ts)
  'omnicode__health_check', 'omnicode__list_tools', 'omnicode__get_tool_schema', 'omnicode__invoke_tool',
  'omnicode__session_resume_brief', 'omnicode__index_project', 'omnicode__search_symbols', 'omnicode__get_symbol',
  'omnicode__get_file_slice', 'omnicode__get_file_context', 'omnicode__file_outline', 'omnicode__repo_map',
  'omnicode__route_map', 'omnicode__test_map', 'omnicode__config_map', 'omnicode__spaghetti_report',
  'omnicode__write_repair_handoff', 'omnicode__repair_plan', 'omnicode__dependency_map', 'omnicode__blast_radius',
  'omnicode__dead_code_scan', 'omnicode__blindspot_report', 'omnicode__get_context_bundle', 'omnicode__check_rename_safe',
  'omnicode__plan_turn', 'omnicode__find_references', 'omnicode__check_delete_safe', 'omnicode__get_hotspots',
  'omnicode__get_session_stats', 'omnicode__token_savings_stats', 'omnicode__runtime_telemetry', 'omnicode__get_churn_rate',
  'omnicode__get_call_hierarchy', 'omnicode__benchmark', 'omnicode__clone_and_index', 'omnicode__language_support',
  'omnicode__resolve_all', 'omnicode__blindspot_explorer', 'omnicode__audit_agent_config',
  // Bare names (for policy files that mention tools without the omnicode__ prefix)
  'search_symbols', 'get_symbol', 'get_file_slice', 'get_file_context', 'file_outline', 'repo_map',
  'route_map', 'test_map', 'config_map', 'spaghetti_report', 'write_repair_handoff', 'repair_plan',
  'dependency_map', 'blast_radius', 'dead_code_scan', 'blindspot_report', 'get_context_bundle',
  'check_rename_safe', 'plan_turn', 'find_references', 'check_delete_safe', 'get_hotspots',
  'get_call_hierarchy', 'clone_and_index', 'language_support', 'resolve_all', 'blindspot_explorer',
  'audit_agent_config', 'index_project', 'session_resume_brief', 'get_churn_rate',
  // jCodeMunch
  'jcodemunch__list_repos', 'jcodemunch__search_symbols', 'jcodemunch__get_ranked_context',
  'jcodemunch__get_file_outline', 'jcodemunch__get_repo_outline', 'jcodemunch__find_references',
  'jcodemunch__get_symbol_source', 'jcodemunch__get_file_content', 'jcodemunch__get_file_tree',
  'jcodemunch__resolve_repo', 'jcodemunch__announce_model', 'jcodemunch_guide', 'jcodemunch__search_text',
  'jcodemunch__find_importers', 'jcodemunch__assemble_task_context', 'jcodemunch__get_context_bundle',
  'jcodemunch__set_tool_tier',
  'list_repos', 'search_symbols', 'get_ranked_context', 'get_file_outline', 'get_repo_outline',
  'find_references', 'get_symbol_source', 'get_file_content', 'get_file_tree', 'resolve_repo',
  'announce_model', 'search_text', 'find_importers', 'assemble_task_context',
  // Common shell verbs that often appear in agent instructions
  'cat', 'head', 'tail', 'sed', 'awk', 'find', 'ls',
]);

const ANTI_PATTERN_PATTERNS: Array<{ regex: RegExp; category: string; severity: Severity; fix: string }> = [
  {
    regex: /\b(cat|head|tail|less|more)\s+[^\n]{0,80}\.(ts|js|py|tsx|jsx|go|rs|java|kt)\b/i,
    category: 'RAW_READ_ANTI_PATTERN',
    severity: 'medium',
    fix: 'Replace with `get_file_slice` (bounded line range) or `file_outline` (one-symbol-at-a-time) — bounded + auditable.',
  },
  {
    regex: /\buse\s+(grep|ripgrep)\s+to\s+search\s+code\b/i,
    category: 'GREP_OVER_RETRIEVAL',
    severity: 'medium',
    fix: 'Prefer `search_symbols` (OCAP, ranked retrieval, path interning) over raw grep — typically 60-80% fewer tokens.',
  },
  {
    regex: /\balways\s+read\s+the\s+entire\s+file\b/i,
    category: 'RAW_READ_ANTI_PATTERN',
    severity: 'high',
    fix: 'Replace with `get_file_outline` first, then `get_file_slice` for the specific symbols you need. Never read entire files.',
  },
  {
    regex: /\b(read|cat)\s+every\s+file\b/i,
    category: 'RAW_READ_ANTI_PATTERN',
    severity: 'high',
    fix: 'Never read every file. Use `repo_map` for a high-level view, then drill into specific symbols.',
  },
  {
    regex: /\b(use|via)\s+webfetch\s+for\s+every\s+url\b/i,
    category: 'TOKEN_WASTE',
    severity: 'low',
    fix: 'Prefer `exa-search` or batched WebSearch when you need multiple URLs. WebFetch is per-URL and burns context.',
  },
];

const TOKEN_WASTE_THRESHOLD = 4000;

async function readFileSafe(p: string): Promise<ScannedFile> {
  const exists = fs.existsSync(p);
  if (!exists) return { path: p, kind: 'missing', content: '', exists: false };
  const content = await fsp.readFile(p, 'utf8');
  const ext = path.extname(p).toLowerCase();
  const kind: ScannedFile['kind'] = ext === '.json' ? 'json' : ext === '.toml' ? 'toml' : ext === '.md' ? 'markdown' : 'text';
  return { path: p, kind, content, exists: true };
}

function tryParseJson(content: string): { ok: true; value: any } | { ok: false; error: string } {
  try { return { ok: true, value: JSON.parse(content) }; } catch (e: any) { return { ok: false, error: e.message }; }
}

function extractPathsFromText(text: string): string[] {
  const out = new Set<string>();
  // Windows-style absolute paths
  const win = text.match(/(?:[A-Za-z]:\\|\\\\)[^\s`'"<>|*?]+/g) || [];
  for (const p of win) out.add(p.replace(/[),.;:]+$/, ''));
  // Unix-style absolute paths
  const unix = text.match(/(?:\/[\w.-]+){2,}/g) || [];
  for (const p of unix) out.add(p.replace(/[),.;:]+$/, ''));
  // Backtick-wrapped paths
  const bt = text.match(/`([^`\n]*\.[a-zA-Z0-9]{1,5})`/g) || [];
  for (const m of bt) {
    const inner = m.slice(1, -1);
    if (inner.includes('/') || inner.includes('\\')) out.add(inner);
  }
  return [...out];
}

function extractToolMentions(text: string): string[] {
  const out = new Set<string>();
  // Tool names with backticks
  const bt = text.match(/`([A-Z][A-Za-z0-9_]{1,30})`/g) || [];
  for (const m of bt) {
    const inner = m.slice(1, -1);
    if (/^[A-Z]/.test(inner) || inner.includes('__')) out.add(inner);
  }
  // snake_case identifiers
  const sc = text.match(/\b([a-z]+(?:_[a-z]+){1,4})\b/g) || [];
  for (const m of sc) {
    if (m.length >= 6 && m.length <= 32) out.add(m);
  }
  return [...out].filter((n) => !KNOWN_TOOL_NAMES.has(n));
}

function extractMcpServers(json: any): Array<{ name: string; command: string; args: string[] }> {
  const out: Array<{ name: string; command: string; args: string[] }> = [];
  const servers = json?.mcpServers || json?.mcp_servers || {};
  for (const [name, conf] of Object.entries<any>(servers)) {
    if (!conf) continue;
    const command = conf.command || '';
    const args = Array.isArray(conf.args) ? conf.args : [];
    out.push({ name, command, args });
  }
  return out;
}

async function discoverConfigFiles(target?: string, home: string = HOME): Promise<ScannedFile[]> {
  const candidates: string[] = [];

  if (target) {
    candidates.push(target);
  } else {
    // Claude Code
    candidates.push(path.join(home, '.claude.json'));
    candidates.push(path.join(home, '.claude', 'CLAUDE.md'));
    candidates.push(path.join(home, '.claude', 'AGENTS.md'));
    candidates.push(path.join(home, '.claude', 'settings.json'));
    // Codex
    candidates.push(path.join(home, '.codex', 'config.toml'));
    candidates.push(path.join(home, '.codex', 'AGENTS.md'));
    // Cursor
    candidates.push(path.join(home, '.cursorrules'));
    candidates.push(path.join(home, '.cursor', 'rules'));
    // Cline
    candidates.push(path.join(home, '.clinerules'));
    // Windsurf
    candidates.push(path.join(home, '.windsurfrules'));
    // Copilot
    candidates.push(path.join(home, '.github', 'copilot-instructions.md'));
    // Project-level
    candidates.push(path.join(process.cwd(), 'CLAUDE.md'));
    candidates.push(path.join(process.cwd(), 'AGENTS.md'));
    candidates.push(path.join(process.cwd(), '.cursorrules'));
    // Claude Desktop
    candidates.push(path.join(APPDATA, 'Claude', 'claude_desktop_config.json'));
  }

  const out: ScannedFile[] = [];
  for (const c of candidates) {
    out.push(await readFileSafe(c));
  }
  return out;
}

async function auditOne(file: ScannedFile): Promise<Finding[]> {
  const findings: Finding[] = [];

  if (!file.exists) {
    // Missing policy for known config-bearing clients is not always a finding
    return findings;
  }

  // ── JSON-specific checks (client configs with mcpServers) ──
  if (file.kind === 'json') {
    const parsed = tryParseJson(file.content);
    if (!parsed.ok) {
      findings.push({
        category: 'INVALID_JSON',
        severity: 'high',
        location: file.path,
        evidence: parsed.error,
        fix: 'Fix the JSON syntax. Use a JSON validator; this file may be silently ignored by the client.',
      });
      return findings;
    }
    const servers = extractMcpServers(parsed.value);
    if (servers.length > 0) {
      // MCP server present — check for matching policy file
      const policySiblings = [
        file.path.replace(/[\\/][^\\/]+$/, '') + path.sep + 'CLAUDE.md',
        file.path.replace(/[\\/][^\\/]+$/, '') + path.sep + 'AGENTS.md',
        path.join(HOME, '.claude', 'CLAUDE.md'),
        path.join(HOME, '.claude', 'AGENTS.md'),
      ];
      let hasPolicy = false;
      for (const p of policySiblings) {
        if (fs.existsSync(p)) { hasPolicy = true; break; }
      }
      if (!hasPolicy) {
        findings.push({
          category: 'MISSING_POLICY',
          severity: 'medium',
          location: file.path,
          evidence: `${servers.length} MCP server(s) configured: ${servers.map((s) => s.name).join(', ')}`,
          fix: 'Add a CLAUDE.md / AGENTS.md that tells the agent WHEN to call these MCPs (e.g. "use omnicode__search_symbols before grep, jcodemunch__get_ranked_context for context").',
        });
      }

      // Validate server entries
      for (const srv of servers) {
        if (!srv.command) {
          findings.push({
            category: 'MCP_CONFIG_ERROR',
            severity: 'high',
            location: `${file.path} → ${srv.name}`,
            evidence: 'mcpServers entry has no "command"',
            fix: 'Add a valid "command" (e.g. "cmd", "node", "npx") and "args" pointing to the actual launcher.',
          });
        }
        if (srv.command === 'cmd' && srv.args.length > 0) {
          const launcher = String(srv.args[srv.args.length - 1] || '');
          if (launcher.endsWith('.cmd') && !fs.existsSync(launcher)) {
            findings.push({
              category: 'STALE_PATH',
              severity: 'high',
              location: `${file.path} → ${srv.name}`,
              evidence: `launcher not found on disk: ${launcher}`,
              fix: 'Update the path or remove the entry. A missing launcher means this MCP silently fails to start.',
            });
          }
        }
      }
    }
  }

  // ── Text / markdown checks (policy files) ──
  if (file.kind === 'markdown' || file.kind === 'text') {
    const text = file.content;

    // Token waste
    if (text.length > TOKEN_WASTE_THRESHOLD) {
      findings.push({
        category: 'TOKEN_WASTE',
        severity: text.length > 8000 ? 'high' : 'medium',
        location: file.path,
        evidence: `${text.length} bytes (~${Math.round(text.length / 4)} tokens) injected into every turn`,
        fix: 'Trim to the rules the agent actually needs. Move long examples to a `references/` file the agent reads on demand.',
      });
    }

    // Stale path references
    const paths = extractPathsFromText(text);
    for (const p of paths) {
      if (p.includes('${') || p.includes('{{') || p.includes('<') || p.includes('*')) continue;
      if (!fs.existsSync(p)) {
        findings.push({
          category: 'STALE_PATH',
          severity: p.startsWith(HOME) ? 'medium' : 'low',
          location: file.path,
          evidence: `path referenced but missing: ${p}`,
          fix: 'Update the path or remove the reference. Stale paths train the agent to expect files that no longer exist.',
        });
      }
    }

    // Anti-patterns
    for (const pat of ANTI_PATTERN_PATTERNS) {
      const m = text.match(pat.regex);
      if (m) {
        findings.push({
          category: pat.category,
          severity: pat.severity,
          location: file.path,
          evidence: m[0].slice(0, 120),
          fix: pat.fix,
        });
      }
    }

    // Phantom tool mentions (only in markdown/text — TOML keys are config, not policy)
    const mentions = extractToolMentions(text);
    for (const m of mentions) {
      if (/^(true|false|null|undefined|this|that|args|kwargs|var|let|const|def|class|function|return|if|else|for|while|import|from|export|require)$/i.test(m)) continue;
      if (m.length < 6) continue;
      findings.push({
        category: 'PHANTOM_TOOL',
        severity: 'low',
        location: file.path,
        evidence: `tool/symbol mentioned but not in known registry: ${m}`,
        fix: `Verify this tool exists in the current MCP registry. If it was renamed or removed, update the policy. Run list_tools to confirm.`,
      });
    }
  }

  // ── TOML-specific checks: stale path references only (keys are config, not mentions) ──
  if (file.kind === 'toml') {
    const paths = extractPathsFromText(file.content);
    for (const p of paths) {
      if (p.includes('${') || p.includes('{{') || p.includes('<') || p.includes('*')) continue;
      if (p.startsWith('http') || p.startsWith('/github.com')) continue;
      if (!fs.existsSync(p)) {
        findings.push({
          category: 'STALE_PATH',
          severity: p.startsWith(HOME) ? 'medium' : 'low',
          location: file.path,
          evidence: `path referenced but missing: ${p}`,
          fix: 'Update the path or remove the reference. Stale paths train the agent to expect files that no longer exist.',
        });
      }
    }
  }

  return findings;
}

function dedupeByKey(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.category}::${f.location}::${f.evidence}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, f);
    } else if (severityRank(f.severity) > severityRank(existing.severity)) {
      seen.set(key, f);
    }
  }
  return [...seen.values()];
}

function severityRank(s: Severity): number {
  return s === 'high' ? 3 : s === 'medium' ? 2 : 1;
}

export async function auditAgentConfig(opts: AuditOptions = {}): Promise<{ result: string; findings: Finding[]; files_scanned: number }> {
  const files = await discoverConfigFiles(opts.target, opts.home);
  const existing = files.filter((f) => f.exists);
  const missingPolicyHint = files.filter((f) => !f.exists && /CLAUDE\.md|AGENTS\.md|\.cursorrules|\.clinerules|\.windsurfrules$/.test(f.path));

  const allFindings: Finding[] = [];
  for (const f of existing) {
    const findings = await auditOne(f);
    allFindings.push(...findings);
  }

  const deduped = dedupeByKey(allFindings).sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  // Also report "no policy files at all" if the JSON config is present and ALL policy files are missing
  const hasAnyPolicy = existing.some((f) => f.kind === 'markdown');
  const hasAnyConfig = existing.some((f) => f.kind === 'json');
  if (hasAnyConfig && !hasAnyPolicy) {
    deduped.unshift({
      category: 'GLOBAL_MISSING_POLICY',
      severity: 'high',
      location: HOME,
      evidence: 'MCP client config exists but no CLAUDE.md / AGENTS.md / .cursorrules was found',
      fix: 'Create ~/.claude/CLAUDE.md (or project-level equivalent) with: (1) which MCP to prefer, (2) the most common anti-patterns to avoid, (3) max token budget for the policy itself.',
    });
  }

  // ── Build the text report ──
  const sevCounts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of deduped) sevCounts[f.severity]++;

  const lines: string[] = [];
  lines.push(`# Agent Config Audit — ${existing.length} file(s) scanned`);
  lines.push('');
  lines.push(`Severity: ${sevCounts.high} high · ${sevCounts.medium} medium · ${sevCounts.low} low`);
  lines.push(`Files scanned: ${existing.map((f) => path.basename(f.path)).join(', ')}`);
  if (missingPolicyHint.length > 0) {
    lines.push(`Files NOT found (informational): ${missingPolicyHint.map((f) => path.basename(f.path)).join(', ')}`);
  }
  lines.push('');

  if (deduped.length === 0) {
    lines.push('No issues found. Agent config is clean.');
  } else {
    const grouped: Record<string, Finding[]> = {};
    for (const f of deduped) {
      (grouped[f.category] = grouped[f.category] || []).push(f);
    }
    for (const [cat, fs] of Object.entries(grouped)) {
      lines.push(`## [${cat}] × ${fs.length}`);
      for (const f of fs) {
        lines.push(`  • [${f.severity}] ${path.basename(f.location)}`);
        lines.push(`    evidence: ${f.evidence.slice(0, 200)}`);
        lines.push(`    fix:      ${f.fix}`);
      }
      lines.push('');
    }
  }

  return { result: lines.join('\n').trim(), findings: deduped, files_scanned: existing.length };
}
