// ───────────────────────────────────────────────────────────────────────────
// Weighted Reciprocal Rank (WRR) fusion — ported from jcodemunch's
// retrieval/signal_fusion.py.
//
// Merges independent ranked channels into one list. For every id that appears
// in any channel:
//
//     score(s) = Σ  weight[c] / (k + rank(c, s))      (rank is 0-based)
//
// Channels (by default weight):
//   identity   2.0  — exact / prefix name match (almost always what's wanted)
//   similarity 0.8  — embedding cosine (DARK until real embeddings land)
//   lexical    1.0  — BM25 keyword relevance
//   structural 0.4  — PageRank / import-graph centrality (tiebreaker)
// ───────────────────────────────────────────────────────────────────────────

export const DEFAULT_WEIGHTS: Record<string, number> = {
  identity: 2.0,
  lexical: 1.0,
  similarity: 0.8,
  structural: 0.4,
};

export const DEFAULT_SMOOTHING = 60;

export interface ChannelResult {
  name: string;
  rankedIds: string[];      // most → least relevant; only matched ids
  weight?: number;
}

export interface FusedHit {
  id: string;
  score: number;
  channels: string[];       // which channels contributed (for debug/confidence)
}

export function fuse(
  channels: ChannelResult[],
  weights: Record<string, number> = DEFAULT_WEIGHTS,
  k: number = DEFAULT_SMOOTHING
): FusedHit[] {
  const acc = new Map<string, { score: number; channels: string[] }>();

  for (const ch of channels) {
    const w = ch.weight ?? weights[ch.name] ?? 1.0;
    if (w === 0) continue; // dark channel
    for (let rank = 0; rank < ch.rankedIds.length; rank++) {
      const id = ch.rankedIds[rank];
      const contribution = w / (k + rank);
      const entry = acc.get(id);
      if (entry) {
        entry.score += contribution;
        entry.channels.push(ch.name);
      } else {
        acc.set(id, { score: contribution, channels: [ch.name] });
      }
    }
  }

  const fused: FusedHit[] = [];
  for (const [id, v] of acc) fused.push({ id, score: v.score, channels: v.channels });
  fused.sort((a, b) => b.score - a.score);
  return fused;
}
