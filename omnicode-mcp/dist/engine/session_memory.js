"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.repoHash = repoHash;
exports.memoryFilePath = memoryFilePath;
exports.appendMemoryEvent = appendMemoryEvent;
exports.readRecentMemory = readRecentMemory;
exports.summarizeMemory = summarizeMemory;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const redact_1 = require("../security/redact");
const VALID_TYPES = new Set([
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
function repoHash(repoPath) {
    return crypto_1.default.createHash('sha256').update(path_1.default.resolve(repoPath)).digest('hex').slice(0, 16);
}
function memoryFilePath(repoPath) {
    return path_1.default.join(path_1.default.resolve(repoPath), '.omnicode', 'memory.jsonl');
}
function redactValue(value) {
    if (typeof value === 'string')
        return (0, redact_1.redactSecrets)(value);
    if (Array.isArray(value))
        return value.map(redactValue);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, inner] of Object.entries(value)) {
            out[key] = redactValue(inner);
        }
        return out;
    }
    return value;
}
function appendMemoryEvent(repoPath, event) {
    if (!VALID_TYPES.has(event.type)) {
        throw new Error(`Unsupported memory event type: ${event.type}`);
    }
    const file = memoryFilePath(repoPath);
    fs_1.default.mkdirSync(path_1.default.dirname(file), { recursive: true });
    const normalized = {
        id: crypto_1.default.randomUUID(),
        ts: new Date().toISOString(),
        repo_hash: repoHash(repoPath),
        type: event.type,
        summary: (0, redact_1.redactSecrets)(String(event.summary || '').slice(0, 1000)),
        source: event.source ? (0, redact_1.redactSecrets)(String(event.source).slice(0, 120)) : undefined,
        data: redactValue(event.data || {}),
    };
    fs_1.default.appendFileSync(file, `${JSON.stringify(normalized)}\n`, 'utf8');
    return normalized;
}
function readRecentMemory(repoPath, limit = 50) {
    const file = memoryFilePath(repoPath);
    if (!fs_1.default.existsSync(file))
        return [];
    const hash = repoHash(repoPath);
    const lines = fs_1.default.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    const events = [];
    for (const line of lines.slice(-Math.max(limit * 3, limit))) {
        try {
            const parsed = JSON.parse(line);
            if (parsed.repo_hash === hash && VALID_TYPES.has(parsed.type))
                events.push(parsed);
        }
        catch {
            // Ignore hand-edited or corrupted lines; append-only memory must remain readable.
        }
    }
    return events.slice(-limit);
}
function summarizeMemory(repoPath, limit = 100) {
    const events = readRecentMemory(repoPath, limit);
    const latest = (type) => [...events].reverse().find((event) => event.type === type);
    const byType = events.reduce((acc, event) => {
        acc[event.type] = (acc[event.type] || 0) + 1;
        return acc;
    }, {});
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
