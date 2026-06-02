import fs from 'fs';
import path from 'path';

export interface OmniCodeConfig {
  projectRoot?: string;
  ignorePatterns?: string[];
  maxFileBytes?: number;
}

const CONFIG_FILES = ['omnicode.config.json', 'token-saver.config.json'];

function parseIgnorePatterns(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function readConfigFile(startDir: string): OmniCodeConfig {
  const dir = path.resolve(startDir || process.cwd());
  for (const name of CONFIG_FILES) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        projectRoot: typeof parsed.projectRoot === 'string' ? parsed.projectRoot : undefined,
        ignorePatterns: parseIgnorePatterns(parsed.ignorePatterns),
        maxFileBytes: typeof parsed.maxFileBytes === 'number' ? parsed.maxFileBytes : undefined,
      };
    } catch (err: any) {
      throw new Error(`Invalid OmniCode config ${filePath}: ${err.message}`);
    }
  }
  return {};
}

export function loadOmniCodeConfig(baseDir = process.cwd()): OmniCodeConfig {
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

export function resolveConfiguredRepoPath(inputPath?: string): string {
  const config = loadOmniCodeConfig(inputPath && fs.existsSync(inputPath) && fs.statSync(inputPath).isDirectory() ? inputPath : process.cwd());
  const root = inputPath || config.projectRoot || process.env.PROJECT_ROOT || process.cwd();
  const resolved = path.resolve(root);
  if (config.projectRoot && !path.isAbsolute(config.projectRoot)) {
    return path.resolve(process.cwd(), config.projectRoot);
  }
  return resolved;
}

export function mergeConfigOptions(repoPath: string, options: { ignorePatterns?: string[]; maxFileBytes?: number } = {}) {
  const config = loadOmniCodeConfig(repoPath);
  return {
    ...options,
    ignorePatterns: options.ignorePatterns || config.ignorePatterns,
    maxFileBytes: options.maxFileBytes || config.maxFileBytes,
  };
}
