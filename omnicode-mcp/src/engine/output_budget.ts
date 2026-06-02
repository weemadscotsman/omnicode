import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { redactSecrets } from '../security/redact';
import { recordOutputSpill } from '../telemetry';

export type OutputMode = 'off' | 'monitor' | 'active';

export interface McpTextResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

export function getOutputMode(): OutputMode {
  const raw = (process.env.OMNICODE_OUTPUT_MODE || 'active').toLowerCase();
  if (raw === 'off' || raw === 'monitor' || raw === 'active') return raw;
  return 'active';
}

function maxResponseTokens(): number {
  const n = Number(process.env.OMNICODE_MAX_RESPONSE_TOKENS || 8000);
  return Number.isFinite(n) && n > 500 ? n : 8000;
}

function summaryTokens(): number {
  const n = Number(process.env.OMNICODE_SUMMARY_TOKENS || 1200);
  return Number.isFinite(n) && n > 100 ? n : 1200;
}

function safeToolName(toolName: string): string {
  return toolName.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'tool';
}

function artifactRoot(repoPath?: string): string | null {
  if (!repoPath) return null;
  return path.join(path.resolve(repoPath), '.omnicode', 'artifacts');
}

function writeArtifact(repoPath: string, toolName: string, text: string): string {
  const root = artifactRoot(repoPath);
  if (!root) throw new Error('artifact root unavailable');
  fs.mkdirSync(root, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 8);
  const filePath = path.join(root, `${stamp}-${safeToolName(toolName)}-${hash}.md`);
  fs.writeFileSync(filePath, text, 'utf8');
  return filePath;
}

function summarize(text: string, tokenBudget: number): string {
  const maxChars = Math.max(400, tokenBudget * 4);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd();
}

/**
 * Redact first, then spill oversized outputs to a local artifact. This prevents
 * large tool payloads from becoming a second token fire while preserving the
 * complete result on disk for the operator and future agents.
 */
export function applyOutputBudget(toolName: string, repoPath: string | undefined, result: McpTextResult): McpTextResult {
  if (!result.content || !Array.isArray(result.content)) return result;

  for (const item of result.content) {
    if (item.type === 'text' && typeof item.text === 'string') {
      item.text = redactSecrets(item.text);
    }
  }

  if (result.isError) return result;

  const mode = getOutputMode();
  if (mode === 'off') return result;

  const maxTokens = maxResponseTokens();
  const textItem = result.content.find((item) => item.type === 'text' && typeof item.text === 'string');
  if (!textItem || typeof textItem.text !== 'string') return result;

  const originalText = textItem.text;
  const originalTokens = estimateTokens(originalText);
  if (originalTokens <= maxTokens) return result;

  if (mode === 'monitor' || !repoPath) {
    textItem.text = originalText +
      `\n\n[OmniCode output budget monitor: ${originalTokens} estimated tokens exceeds limit ${maxTokens}. Set OMNICODE_OUTPUT_MODE=active to spill oversized output to artifacts.]`;
    return result;
  }

  const artifactPath = writeArtifact(repoPath, toolName, originalText);
  const summary = summarize(originalText, summaryTokens());
  const returned = [
    `OmniCode output budget active.`,
    `Tool: ${toolName}`,
    `Original estimated tokens: ${originalTokens}`,
    `Returned estimated tokens: ${estimateTokens(summary)}`,
    `Full redacted output artifact: ${artifactPath}`,
    '',
    '--- Compact Summary ---',
    summary,
    '',
    `--- End Summary: full output is in ${artifactPath} ---`,
  ].join('\n');

  textItem.text = returned;
  recordOutputSpill(toolName, originalTokens, estimateTokens(returned), Buffer.byteLength(originalText, 'utf8'));
  return result;
}

export function outputBudgetConfig() {
  return {
    mode: getOutputMode(),
    max_response_tokens: maxResponseTokens(),
    summary_tokens: summaryTokens(),
    artifact_base: process.env.OMNICODE_ARTIFACT_BASE || '.omnicode/artifacts',
    temp_dir: os.tmpdir(),
  };
}
