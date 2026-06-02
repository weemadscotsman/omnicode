"use strict";
// ───────────────────────────────────────────────────────────────────────────
// Parallel parse pool. tree-sitter parsing is the CPU-bound phase of indexing;
// on an 8-core box, one thread leaves 7 idle. This pool fans file parsing across
// worker_threads. Workers share the parent's Node runtime, so the native parser
// ABI always matches — no version-mismatch risk.
//
// Safety: every failure path falls back to synchronous parseSource on the main
// thread. A broken worker can never break or stall an index.
// ───────────────────────────────────────────────────────────────────────────
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParsePool = void 0;
exports.defaultPoolSize = defaultPoolSize;
const worker_threads_1 = require("worker_threads");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const parser_1 = require("./parser");
const WORKER_PATH = path_1.default.join(__dirname, 'parse_worker.js');
function defaultPoolSize() {
    return Math.max(1, Math.min(7, (os_1.default.cpus()?.length || 2) - 1));
}
// A single file should never hang the whole index. If a worker doesn't return a
// parse within this budget, the worker is terminated, the file is recorded as a
// PARSE_TIMEOUT blindspot, and a replacement worker is spawned. We do NOT fall
// back to synchronous parseSource on timeout — that would hang the main thread on
// the very file that hung the worker.
const PARSE_TIMEOUT_MS = Math.max(1000, Number(process.env.OMNICODE_PARSE_TIMEOUT_MS || 10000));
function timeoutResult(filePath) {
    const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : '';
    return {
        symbols: [], callEdges: [], imports: [],
        blindspots: [`PARSE_TIMEOUT|warn|parse exceeded ${PARSE_TIMEOUT_MS}ms — file abandoned|hint=likely minified/generated; raise OMNICODE_PARSE_TIMEOUT_MS or exclude it`],
        parserMode: 'none', parseQuality: 0, languageName: ext.replace('.', '') || 'unknown',
    };
}
class ParsePool {
    workers = [];
    idle = [];
    queue = [];
    pending = new Map();
    timers = new Map();
    seq = 0;
    healthy = false;
    constructor(size = defaultPoolSize()) {
        try {
            for (let i = 0; i < size; i++)
                this.spawnWorker();
            this.healthy = this.workers.length > 0;
        }
        catch {
            this.healthy = false;
        }
    }
    /** Create one worker, wire its handlers, register it as idle. Returns it (or null). */
    spawnWorker() {
        try {
            const w = new worker_threads_1.Worker(WORKER_PATH);
            w.on('message', (m) => this.onMessage(w, m));
            w.on('error', () => this.onWorkerError(w));
            this.workers.push(w);
            this.idle.push(w);
            return w;
        }
        catch {
            return null;
        }
    }
    /** True if at least one worker is alive; false means callers should run sync. */
    get usable() {
        return this.healthy && this.workers.length > 0;
    }
    parse(p, content) {
        if (!this.usable)
            return Promise.resolve((0, parser_1.parseSource)(p, content));
        return new Promise((resolve) => {
            this.queue.push({ path: p, content, resolve });
            this.pump();
        });
    }
    pump() {
        while (this.idle.length > 0 && this.queue.length > 0) {
            const w = this.idle.pop();
            const job = this.queue.shift();
            const id = ++this.seq;
            this.pending.set(id, job);
            w.__job = id;
            this.timers.set(id, setTimeout(() => this.onTimeout(w, id), PARSE_TIMEOUT_MS));
            w.postMessage({ id, path: job.path, content: job.content });
        }
    }
    clearTimer(id) {
        const t = this.timers.get(id);
        if (t) {
            clearTimeout(t);
            this.timers.delete(id);
        }
    }
    /** A worker took too long on one file: kill it, stub the file, replace the worker. */
    onTimeout(w, id) {
        const job = this.pending.get(id);
        this.timers.delete(id);
        this.pending.delete(id);
        w.__job = undefined;
        this.workers = this.workers.filter((x) => x !== w);
        this.idle = this.idle.filter((x) => x !== w);
        try {
            w.terminate();
        }
        catch { /* ignore */ }
        this.spawnWorker(); // keep the pool at size
        this.healthy = this.workers.length > 0;
        if (job)
            job.resolve(timeoutResult(job.path)); // NOT sync fallback — that file hangs
        this.pump();
    }
    onMessage(w, m) {
        this.clearTimer(m.id);
        const job = this.pending.get(m.id);
        this.pending.delete(m.id);
        w.__job = undefined;
        this.idle.push(w);
        if (job) {
            if (m.ok)
                job.resolve(m.result);
            else
                job.resolve((0, parser_1.parseSource)(job.path, job.content)); // worker-side error → sync fallback
        }
        this.pump();
    }
    onWorkerError(w) {
        // Reassign the dead worker's in-flight job to a sync fallback, then drop it.
        const jobId = w.__job;
        if (jobId != null) {
            this.clearTimer(jobId);
            const job = this.pending.get(jobId);
            this.pending.delete(jobId);
            if (job)
                job.resolve((0, parser_1.parseSource)(job.path, job.content));
        }
        this.workers = this.workers.filter((x) => x !== w);
        this.idle = this.idle.filter((x) => x !== w);
        try {
            w.terminate();
        }
        catch { /* ignore */ }
        this.spawnWorker(); // keep the pool at size
        this.healthy = this.workers.length > 0;
        this.pump();
    }
    async destroy() {
        for (const t of this.timers.values())
            clearTimeout(t);
        this.timers.clear();
        const ws = this.workers;
        this.workers = [];
        this.idle = [];
        await Promise.all(ws.map((w) => w.terminate().catch(() => undefined)));
    }
}
exports.ParsePool = ParsePool;
