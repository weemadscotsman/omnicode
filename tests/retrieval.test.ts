import { describe, it, expect } from 'vitest';
import { Bm25Index, tokenize } from '../omnicode-mcp/src/retrieval/bm25';
import { fuse } from '../omnicode-mcp/src/retrieval/signal_fusion';
import { computeConfidence } from '../omnicode-mcp/src/retrieval/confidence';

describe('BM25 lexical retrieval', () => {
  it('tokenizes camelCase, PascalCase, snake_case, kebab-case and paths', () => {
    expect(tokenize('getUserProfile user-service/src/FooBar.ts')).toEqual([
      'get', 'user', 'profile', 'user', 'service', 'src', 'foo', 'bar', 'ts'
    ]);
  });

  it('ranks stronger lexical matches above weaker matches', () => {
    const idx = new Bm25Index([
      { id: 'exact', tokens: tokenize('user dashboard dashboard api') },
      { id: 'weak', tokens: tokenize('user helper') },
      { id: 'miss', tokens: tokenize('billing invoice') },
    ]);
    const hits = idx.search('dashboard user');
    expect(hits.map((h) => h.id)).toEqual(['exact', 'weak']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('returns no hits for empty or unmatched queries', () => {
    const idx = new Bm25Index([{ id: 'a', tokens: tokenize('alpha') }]);
    expect(idx.search('')).toEqual([]);
    expect(idx.search('zebra')).toEqual([]);
  });
});

describe('WRR signal fusion', () => {
  it('promotes ids that appear across multiple channels', () => {
    const hits = fuse([
      { name: 'identity', rankedIds: ['alpha', 'beta'] },
      { name: 'lexical', rankedIds: ['beta', 'gamma'] },
      { name: 'structural', rankedIds: ['beta', 'alpha'] },
    ]);
    expect(hits[0].id).toBe('beta');
    expect(hits[0].channels.sort()).toEqual(['identity', 'lexical', 'structural']);
  });

  it('keeps dark channels from affecting results', () => {
    const hits = fuse([
      { name: 'identity', rankedIds: ['real'] },
      { name: 'similarity', rankedIds: ['fake'], weight: 0 },
    ]);
    expect(hits.map((h) => h.id)).toEqual(['real']);
  });

  it('uses rank order inside a channel', () => {
    const hits = fuse([{ name: 'lexical', rankedIds: ['first', 'second'] }]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });
});

describe('calibrated confidence', () => {
  it('is higher when the top hit dominates and identity matches', () => {
    const strong = computeConfidence([0.08, 0.01], { hasIdentityMatch: true });
    const weak = computeConfidence([0.08, 0.075], { hasIdentityMatch: false });
    expect(strong.confidence).toBeGreaterThan(weak.confidence);
    expect(strong.components.identity).toBe(1);
  });

  it('penalizes stale results', () => {
    const fresh = computeConfidence([0.08, 0.01], { hasIdentityMatch: true, isStale: false });
    const stale = computeConfidence([0.08, 0.01], { hasIdentityMatch: true, isStale: true });
    expect(stale.confidence).toBeLessThan(fresh.confidence);
    expect(stale.components.freshness).toBe(0.6);
  });

  it('returns zero confidence for no scores', () => {
    const result = computeConfidence([], { hasIdentityMatch: null });
    expect(result.confidence).toBe(0);
    expect(result.components.gap).toBe(0);
  });
});
