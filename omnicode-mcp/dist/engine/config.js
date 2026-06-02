"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadOmniCodeConfig = loadOmniCodeConfig;
exports.resolveConfiguredRepoPath = resolveConfiguredRepoPath;
exports.mergeConfigOptions = mergeConfigOptions;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const CONFIG_FILES = ['omnicode.config.json', 'token-saver.config.json'];
function parseIgnorePatterns(value) {
    if (Array.isArray(value))
        return value.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof value === 'string')
        return value.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
}
function readConfigFile(startDir) {
    const dir = path_1.default.resolve(startDir || process.cwd());
    for (const name of CONFIG_FILES) {
        const filePath = path_1.default.join(dir, name);
        if (!fs_1.default.existsSync(filePath))
            continue;
        try {
            const parsed = JSON.parse(fs_1.default.readFileSync(filePath, 'utf8'));
            return {
                projectRoot: typeof parsed.projectRoot === 'string' ? parsed.projectRoot : undefined,
                ignorePatterns: parseIgnorePatterns(parsed.ignorePatterns),
                maxFileBytes: typeof parsed.maxFileBytes === 'number' ? parsed.maxFileBytes : undefined,
            };
        }
        catch (err) {
            throw new Error(`Invalid OmniCode config ${filePath}: ${err.message}`);
        }
    }
    return {};
}
function loadOmniCodeConfig(baseDir = process.cwd()) {
    const fileConfig = readConfigFile(baseDir);
    const envProjectRoot = process.env.PROJECT_ROOT || process.env.OMNICODE_PROJECT_ROOT;
    const envIgnore = parseIgnorePatterns(process.env.IGNORE_PATTERNS || process.env.OMNICODE_IGNORE_PATTERNS);
    const envMaxFileBytes = Number(process.env.OMNICODE_MAX_FILE_BYTES || '');
    return {
        ...fileConfig,
        projectRoot: envProjectRoot || fileConfig.projectRoot,
        ignorePatterns: envIgnore.length ? envIgnore : fileConfig.ignorePatterns,
        maxFileBytes: Number.isFinite(envMaxFileBytes) && envMaxFileBytes > 0 ? envMaxFileBytes : fileConfig.maxFileBytes,
    };
}
function resolveConfiguredRepoPath(inputPath) {
    const config = loadOmniCodeConfig(inputPath && fs_1.default.existsSync(inputPath) && fs_1.default.statSync(inputPath).isDirectory() ? inputPath : process.cwd());
    const root = inputPath || config.projectRoot || process.env.PROJECT_ROOT || process.cwd();
    const resolved = path_1.default.resolve(root);
    if (config.projectRoot && !path_1.default.isAbsolute(config.projectRoot)) {
        return path_1.default.resolve(process.cwd(), config.projectRoot);
    }
    return resolved;
}
function mergeConfigOptions(repoPath, options = {}) {
    const config = loadOmniCodeConfig(repoPath);
    return {
        ...options,
        ignorePatterns: options.ignorePatterns || config.ignorePatterns,
        maxFileBytes: options.maxFileBytes || config.maxFileBytes,
    };
}
