import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
const { parseSource } = require('../omnicode-mcp/dist/engine/parser');

describe('parser suppresses null-byte tool artifacts but keeps real errors', () => {
  it('parses pagerank.ts clean (the node-tree-sitter null-byte artifact is suppressed)', () => {
    const f = path.resolve(__dirname, '../omnicode-mcp/src/engine/pagerank.ts');
    const r = parseSource(f, fs.readFileSync(f, 'utf8'));
    expect(r.parserMode).toBe('tree-sitter');
    expect(r.parseQuality).toBeGreaterThan(0.95);
    expect(r.blindspots.filter((b: string) => b.includes('PARSE_ERROR')).length).toBe(0);
  });

  it('STILL flags genuinely broken syntax (no over-suppression)', () => {
    const r = parseSource('broken.ts', 'function f( { return ;;; class }');
    expect(r.blindspots.filter((b: string) => b.includes('PARSE_ERROR')).length).toBeGreaterThan(0);
  });

  it('a clean file has zero parse errors', () => {
    const r = parseSource('clean.ts', 'export function add(a: number, b: number) { return a + b; }');
    expect(r.blindspots.filter((b: string) => b.includes('PARSE_ERROR')).length).toBe(0);
  });
});
