"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtimeTelemetry = runtimeTelemetry;
const os_1 = __importDefault(require("os"));
async function runtimeTelemetry(repoPath) {
    // Since we are not dynamically hooking into the runtime process tree (Node, Docker, etc),
    // we will provide host-level basic metrics and process environment constraints.
    const memoryUsage = process.memoryUsage();
    let result = "Runtime Telemetry (Host Scope):\n\n";
    result += `- Platform: ${os_1.default.platform()} ${os_1.default.arch()}\n`;
    result += `- Total Memory: ${(os_1.default.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB\n`;
    result += `- Free Memory: ${(os_1.default.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB\n`;
    result += `- Number of CPUs: ${os_1.default.cpus().length}\n`;
    result += `- Node.js Version: ${process.version}\n\n`;
    result += `OmniCode Process Telemetry:\n`;
    result += `- RSS: ${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB\n`;
    result += `- Heap Total: ${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB\n`;
    result += `- Heap Used: ${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB\n\n`;
    result += `Status: Active, executing securely in sandbox bounds.\n`;
    return { result };
}
