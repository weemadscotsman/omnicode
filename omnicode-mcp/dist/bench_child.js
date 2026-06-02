#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const benchmark_1 = require("./tools/benchmark");
function readArg(name) {
    const idx = process.argv.indexOf(name);
    return idx >= 0 ? process.argv[idx + 1] : undefined;
}
function readNumber(name) {
    const raw = readArg(name);
    return raw == null ? undefined : Number(raw);
}
async function main() {
    const repo = readArg('--repo');
    if (!repo)
        throw new Error('Missing --repo');
    const result = await (0, benchmark_1.benchmarkRepo)(path_1.default.resolve(repo), {
        max_files: readNumber('--max-files'),
        max_bytes: readNumber('--max-bytes'),
        max_scan_ms: readNumber('--max-scan-ms'),
        query: readArg('--query'),
        write: process.argv.includes('--write'),
    });
    process.stdout.write(JSON.stringify(result));
}
main().catch((err) => {
    process.stderr.write(String(err?.stack || err?.message || err));
    process.exit(1);
});
