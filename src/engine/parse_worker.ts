// Worker entry for the parse pool. Runs in a worker_thread, shares the parent's
// Node runtime (so native tree-sitter ABI always matches — no version risk).
// Receives { id, path, content }, returns { id, ok, result | error }.
import { parentPort } from 'worker_threads';
import { parseSource } from './parser';

if (parentPort) {
  parentPort.on('message', (msg: { id: number; path: string; content: string }) => {
    try {
      const result = parseSource(msg.path, msg.content);
      parentPort!.postMessage({ id: msg.id, ok: true, result });
    } catch (e: any) {
      parentPort!.postMessage({ id: msg.id, ok: false, error: String((e && e.message) || e) });
    }
  });
}
