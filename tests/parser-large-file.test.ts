import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
const { parseSource } = require('../omnicode-mcp/dist/engine/parser');

describe('parser handles files larger than the 32KB tree-sitter buffer', () => {
  it('uses tree-sitter (not regex fallback) on a >32KB TS file and finds real symbols', () => {
    // Build ~60KB of valid TypeScript with many real declarations.
    let src = '';
    for (let i = 0; i < 800; i++) {
      src += `export function fn${i}(a: number, b: number): number { if (a > b) { return a; } return b + ${i}; }\n`;
    }
    expect(src.length).toBeGreaterThan(40 * 1024); // safely over the 32KB limit

    const r = parseSource(path.join(os.tmpdir(), 'big.ts'), src);
    expect(r.parserMode).toBe('tree-sitter');           // not 'fallback'
    const names = r.symbols.map((s: any) => s.name);
    expect(names).toContain('fn0');
    expect(names).toContain('fn799');                   // a declaration near the end parsed too
    expect(names).not.toContain('if');                  // keyword guard still holds
  });
});
