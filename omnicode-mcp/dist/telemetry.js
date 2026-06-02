"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordCall = recordCall;
exports.recordOutputSpill = recordOutputSpill;
exports.statusLine = statusLine;
exports.getSessionStats = getSessionStats;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
// Live session telemetry. Tracks measured tool-call payloads plus conservative
// estimates of avoided raw reads and oversized output suppressed into artifacts.
const SESSION_FILE = path_1.default.join(os_1.default.homedir(), '.omnicode', 'session.json');
const AVG_RAW_READ_TOKENS = 1800;
const RETRIEVAL_TOOLS = new Set([
    'search_symbols', 'get_symbol', 'get_file_slice', 'get_file_context',
    'file_outline', 'repo_map', 'route_map', 'test_map', 'config_map',
    'dependency_map', 'blast_radius', 'dead_code_scan', 'blindspot_report',
    'get_context_bundle', 'find_references', 'get_hotspots', 'get_churn_rate',
    'get_call_hierarchy', 'spaghetti_report',
]);
const session = {
    startedAt: Date.now(),
    calls: 0,
    errors: 0,
    tokensReturned: 0,
    tokensSaved: 0,
    tokensSuppressed: 0,
    artifactCount: 0,
    artifactBytesWritten: 0,
    byTool: {},
    lastTool: '',
};
function persist() {
    try {
        fs_1.default.mkdirSync(path_1.default.dirname(SESSION_FILE), { recursive: true });
        fs_1.default.writeFileSync(SESSION_FILE, JSON.stringify(session));
    }
    catch {
        // best effort only
    }
}
function recordCall(tool, returnedText, isError = false) {
    const returned = Math.ceil((returnedText?.length || 0) / 4);
    session.calls++;
    session.lastTool = tool;
    session.tokensReturned += returned;
    session.byTool[tool] = (session.byTool[tool] || 0) + 1;
    if (isError)
        session.errors++;
    else if (RETRIEVAL_TOOLS.has(tool)) {
        session.tokensSaved += Math.max(0, AVG_RAW_READ_TOKENS - returned);
    }
    persist();
}
function recordOutputSpill(tool, originalTokens, returnedTokens, artifactBytes) {
    session.tokensSuppressed += Math.max(0, originalTokens - returnedTokens);
    session.artifactCount++;
    session.artifactBytesWritten += Math.max(0, artifactBytes);
    const key = `${tool}:artifact_spill`;
    session.byTool[key] = (session.byTool[key] || 0) + 1;
    persist();
}
function human(n) {
    if (n >= 1_000_000)
        return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)
        return (n / 1_000).toFixed(1) + 'k';
    return String(n);
}
function uptime() {
    const s = Math.round((Date.now() - session.startedAt) / 1000);
    if (s < 60)
        return `${s}s`;
    if (s < 3600)
        return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}
function statusLine() {
    return `OmniCode active | ${session.calls} calls | ~${human(session.tokensSaved)} saved | ~${human(session.tokensSuppressed)} suppressed | last:${session.lastTool || '-'} | up ${uptime()}`;
}
function getSessionStats() {
    return {
        ...session,
        uptimeSeconds: Math.round((Date.now() - session.startedAt) / 1000),
        tokensSavedHuman: human(session.tokensSaved),
        tokensSuppressedHuman: human(session.tokensSuppressed),
    };
}
