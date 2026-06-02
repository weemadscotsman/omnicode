import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { parseSource } from '../omnicode-mcp/src/engine/parser';

const TS = `
import { helper } from './util';

export function computeTotal(a: number, b: number): number {
  if (a > b) {
    return a;
  }
  for (let i = 0; i < b; i++) {
    while (i < a) {
      i++;
    }
  }
  switch (a) {
    case 1: return 1;
    default: return 0;
  }
  return helper(a + b);
}

export const renderView = (x: number) => {
  try { return x; } catch (e) { return 0; }
};

export class Widget {
  draw() { return 1; }
}
`;

describe('parser symbol extraction — no keyword pollution', () => {
  const f = path.join(os.tmpdir(), 'fixture.ts');
  const r = parseSource(f, TS);
  const names = r.symbols.map((s) => s.name);

  it('extracts the real declared symbols', () => {
    expect(names).toContain('computeTotal');
    expect(names).toContain('renderView');
    expect(names).toContain('Widget');
    expect(names).toContain('draw');
  });

  it('does NOT record control-flow keywords as symbols', () => {
    for (const kw of ['if', 'for', 'while', 'switch', 'case', 'return', 'try', 'catch', 'default']) {
      expect(names).not.toContain(kw);
    }
  });

  it('does not record keywords as call edges', () => {
    const targets = r.callEdges.map((e) => e.toSymbolName);
    for (const kw of ['if', 'for', 'while', 'switch', 'catch', 'return']) {
      expect(targets).not.toContain(kw);
    }
    // but real calls are kept
    expect(targets).toContain('helper');
  });

  it('every extracted symbol name is a valid identifier', () => {
    for (const n of names) {
      expect(n).toMatch(/^[A-Za-z_$][\w$]*[!?=]?$/);
    }
  });
});
