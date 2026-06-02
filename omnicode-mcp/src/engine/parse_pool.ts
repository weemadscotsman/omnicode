// ───────────────────────────────────────────────────────────────────────────
// Parallel parse pool. tree-sitter parsing is the CPU-bound phase of indexing;
// on an 8-core box, one thread leaves 7 idle. This pool fans file parsing across
// worker_threads. Workers share the parent's Node runtime, so the native parser
// ABI always matches — no version-mismatch risk.
//
// Safety: every failure path falls back to synchronous parseSource on the main
// thread. A broken worker can never break or stall an index.
// ───────────────────────────────────────────────────────────────────────────

import { Worker } from 'worker_threads';
import os from 'os';
import path from 'path';
import { parseSource, ParseResult } from './parser';

const WORKER_PATH = path.join(__dirname, 'parse_worker.js');

interface Job {
  path: string;
  content: string;
  resolve: (r: ParseResult) => void;
}

export function defaultPoolSize(): number {
  return Math.max(1, Math.min(7, (os.cpus()?.length || 2) - 1));
}

// A single file should never hang the whole index. If a worker doesn't return a
// parse within this budget, the worker is terminated, the file is recorded as a
// PARSE_TIMEOUT blindspot, and a replacement worker is spawned. We do NOT fall
// back to synchronous parseSource on timeout — that would hang the main thread on
// the very file that hung the worker.
const PARSE_TIMEOUT_MS = Math.max(1000, Number(process.env.OMNICODE_PARSE_TIMEOUT_MS || 10000));

function timeoutResult(filePath: string): ParseResult {
  const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : '';
  return {
    symbols: [], callEdges: [], imports: [],
    blindspots: [`PARSE_TIMEOUT|warn|parse exceeded ${PARSE_TIMEOUT_MS}ms — file abandoned|hint=likely minified/generated; raise OMNICODE_PARSE_TIMEOUT_MS or exclude it`],
    parserMode: 'none', parseQuality: 0, languageName: ext.replace('.', '') || 'unknown',
  };
}

export class ParsePool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private pending = new Map<number, Job>();
  private timers = new Map<number, NodeJS.Timeout>();
  private seq = 0;
  private healthy = false;

  constructor(size: number = defaultPoolSize()) {
    try {
      for (let i = 0; i < size; i++) this.spawnWorker();
      this.healthy = this.workers.length > 0;
    } catch {
      this.healthy = false;
    }
  }

  /** Create one worker, wire its handlers, register it as idle. Returns it (or null). */
  private spawnWorker(): Worker | null {
    try {
      const w = new Worker(WORKER_PATH);
      w.on('message', (m: any) => this.onMessage(w, m));
      w.on('error', () => this.onWorkerError(w));
      this.workers.push(w);
      this.idle.push(w);
      return w;
    } catch {
      return null;
    }
  }

  /** True if at least one worker is alive; false means callers should run sync. */
  get usable(): boolean {
    return this.healthy && this.workers.length > 0;
  }

  parse(p: string, content: string): Promise<ParseResult> {
    if (!this.usable) return Promise.resolve(parseSource(p, content));
    return new Promise<ParseResult>((resolve) => {
      this.queue.push({ path: p, content, resolve });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      const id = ++this.seq;
      this.pending.set(id, job);
      (w as any).__job = id;
      this.timers.set(id, setTimeout(() => this.onTimeout(w, id), PARSE_TIMEOUT_MS));
      w.postMessage({ id, path: job.path, content: job.content });
    }
  }

  private clearTimer(id: number): void {
    const t = this.timers.get(id);
    if (t) { clearTimeout(t); this.timers.delete(id); }
  }

  /** A worker took too long on one file: kill it, stub the file, replace the worker. */
  private onTimeout(w: Worker, id: number): void {
    const job = this.pending.get(id);
    this.timers.delete(id);
    this.pending.delete(id);
    (w as any).__job = undefined;
    this.workers = this.workers.filter((x) => x !== w);
    this.idle = this.idle.filter((x) => x !== w);
    try { w.terminate(); } catch { /* ignore */ }
    this.spawnWorker();                 // keep the pool at size
    this.healthy = this.workers.length > 0;
    if (job) job.resolve(timeoutResult(job.path)); // NOT sync fallback — that file hangs
    this.pump();
  }

  private onMessage(w: Worker, m: any): void {
    this.clearTimer(m.id);
    const job = this.pending.get(m.id);
    this.pending.delete(m.id);
    (w as any).__job = undefined;
    this.idle.push(w);
    if (job) {
      if (m.ok) job.resolve(m.result);
      else job.resolve(parseSource(job.path, job.content)); // worker-side error → sync fallback
    }
    this.pump();
  }

  private onWorkerError(w: Worker): void {
    // Reassign the dead worker's in-flight job to a sync fallback, then drop it.
    const jobId = (w as any).__job as number | undefined;
    if (jobId != null) {
      this.clearTimer(jobId);
      const job = this.pending.get(jobId);
      this.pending.delete(jobId);
      if (job) job.resolve(parseSource(job.path, job.content));
    }
    this.workers = this.workers.filter((x) => x !== w);
    this.idle = this.idle.filter((x) => x !== w);
    try { w.terminate(); } catch { /* ignore */ }
    this.spawnWorker(); // keep the pool at size
    this.healthy = this.workers.length > 0;
    this.pump();
  }

  async destroy(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    const ws = this.workers;
    this.workers = [];
    this.idle = [];
    await Promise.all(ws.map((w) => w.terminate().catch(() => undefined)));
  }
}
