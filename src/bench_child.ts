#!/usr/bin/env node

import path from 'path';
import { benchmarkRepo } from './tools/benchmark';

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function readNumber(name: string): number | undefined {
  const raw = readArg(name);
  return raw == null ? undefined : Number(raw);
}

async function main() {
  const repo = readArg('--repo');
  if (!repo) throw new Error('Missing --repo');
  const result = await benchmarkRepo(path.resolve(repo), {
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
