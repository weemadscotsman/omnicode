import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { redactSecrets } from '../security/redact';

export type MemoryEventType =
  | 'handoff.generated'
  | 'handoff.accepted'
  | 'benchmark.completed'
  | 'repair.refused'
  | 'repair.completed'
  | 'blindspot.detected'
  | 'user.decision'
  | 'risky_file.marked'
  | 'safe_file.marked'
  | 'session.note'
  // C.A.R Phase One — session-aware retrieval signals (appended by tools,
  // consumed by car_rerank). These never carry source bodies — only ids,
  // paths, queries, and counts.
  | 'query'
  | 'symbol_access'
  | 'file_access'
  | 'context_pull'
  | 'task_set';

export interface MemoryEventInput {
  type: MemoryEventType;
  summary: string;
  data?: Record<string, any>;
  source?: string;
}

export interface MemoryEvent extends MemoryEventInput {
  id: string;
  ts: string;
  repo_hash: string;
}

const VALID_TYPES = new Set<MemoryEventType>([
  'handoff.generated',
  'handoff.accepted',
  'benchmark.completed',
  'repair.refused',
  'repair.completed',
  'blindspot.detected',
  'user.decision',
  'risky_file.marked',
  'safe_file.marked',
  'session.note',
  'query',
  'symbol_access',
  'file_access',
  'context_pull',
  'task_set',
]);

export function repoHash(repoPath: string): string {
  return crypto.createHash('sha256').update(path.resolve(repoPath)).digest('hex').slice(0, 16);
}

export function memoryFilePath(repoPath: string): string {
  return path.join(path.resolve(repoPath), '.omnicode', 'memory.jsonl');
}

function redactValue(value: any): any {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = redactValue(inner);
    }
    return out;
  }
  return value;
}

export function appendMemoryEvent(repoPath: string, event: MemoryEventInput): MemoryEvent {
  if (!VALID_TYPES.has(event.type)) {
    throw new Error(`Unsupported memory event type: ${event.type}`);
  }
  const file = memoryFilePath(repoPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const normalized: MemoryEvent = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    repo_hash: repoHash(repoPath),
    type: event.type,
    summary: redactSecrets(String(event.summary || '').slice(0, 1000)),
    source: event.source ? redactSecrets(String(event.source).slice(0, 120)) : undefined,
    data: redactValue(event.data || {}),
  };
  fs.appendFileSync(file, `${JSON.stringify(normalized)}\n`, 'utf8');
  return normalized;
}

export function readRecentMemory(repoPath: string, limit = 50): MemoryEvent[] {
  const file = memoryFilePath(repoPath);
  if (!fs.existsSync(file)) return [];
  const hash = repoHash(repoPath);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const events: MemoryEvent[] = [];
  for (const line of lines.slice(-Math.max(limit * 3, limit))) {
    try {
      const parsed = JSON.parse(line) as MemoryEvent;
      if (parsed.repo_hash === hash && VALID_TYPES.has(parsed.type)) events.push(parsed);
    } catch {
      // Ignore hand-edited or corrupted lines; append-only memory must remain readable.
    }
  }
  return events.slice(-limit);
}

export function summarizeMemory(repoPath: string, limit = 100) {
  const events = readRecentMemory(repoPath, limit);
  const latest = (type: MemoryEventType) => [...events].reverse().find((event) => event.type === type);
  const byType = events.reduce((acc, event) => {
    acc[event.type] = (acc[event.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const safeFiles = events.filter((event) => event.type === 'safe_file.marked').map((event) => event.data?.path || event.summary).filter(Boolean).slice(-10);
  const riskyFiles = events.filter((event) => event.type === 'risky_file.marked').map((event) => event.data?.path || event.summary).filter(Boolean).slice(-10);
  const userDecisions = events.filter((event) => event.type === 'user.decision').map((event) => event.summary).slice(-10);
  return {
    events,
    byType,
    safeFiles,
    riskyFiles,
    userDecisions,
    latestHandoff: latest('handoff.generated'),
    latestBenchmark: latest('benchmark.completed'),
    latestRepairRefusal: latest('repair.refused'),
    latestRepairCompleted: latest('repair.completed'),
  };
}
