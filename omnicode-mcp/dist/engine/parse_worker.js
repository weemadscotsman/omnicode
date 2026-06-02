"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Worker entry for the parse pool. Runs in a worker_thread, shares the parent's
// Node runtime (so native tree-sitter ABI always matches — no version risk).
// Receives { id, path, content }, returns { id, ok, result | error }.
const worker_threads_1 = require("worker_threads");
const parser_1 = require("./parser");
if (worker_threads_1.parentPort) {
    worker_threads_1.parentPort.on('message', (msg) => {
        try {
            const result = (0, parser_1.parseSource)(msg.path, msg.content);
            worker_threads_1.parentPort.postMessage({ id: msg.id, ok: true, result });
        }
        catch (e) {
            worker_threads_1.parentPort.postMessage({ id: msg.id, ok: false, error: String((e && e.message) || e) });
        }
    });
}
