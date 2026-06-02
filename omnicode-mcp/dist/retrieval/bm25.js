"use strict";
// ───────────────────────────────────────────────────────────────────────────
// Real BM25 lexical ranker. Replaces the fuse.js fuzzy blend as the lexical
// channel of the WRR fusion pipeline. Okapi BM25 with k1=1.5, b=0.75.
// ───────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bm25Index = void 0;
exports.tokenize = tokenize;
const K1 = 1.5;
const B = 0.75;
/** Split identifiers into searchable tokens: lowercase, camelCase + snake/kebab/dot boundaries. */
function tokenize(text) {
    if (!text)
        return [];
    return text
        // split camelCase / PascalCase: insert space between lower→Upper and ACRONYM→Word
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}
class Bm25Index {
    docs = [];
    df = new Map(); // document frequency per term
    docLen = new Map();
    avgdl = 0;
    constructor(docs) {
        this.docs = docs;
        let total = 0;
        for (const d of docs) {
            this.docLen.set(d.id, d.tokens.length);
            total += d.tokens.length;
            const seen = new Set();
            for (const t of d.tokens) {
                if (seen.has(t))
                    continue;
                seen.add(t);
                this.df.set(t, (this.df.get(t) || 0) + 1);
            }
        }
        this.avgdl = docs.length ? total / docs.length : 0;
    }
    /** Score every document that shares at least one query term; returns sorted hits (desc). */
    search(query) {
        const qTokens = tokenize(query);
        if (qTokens.length === 0 || this.docs.length === 0)
            return [];
        const N = this.docs.length;
        // Precompute term frequencies per doc only for query terms (cheap pass).
        const qSet = new Set(qTokens);
        const hits = [];
        for (const d of this.docs) {
            const dl = this.docLen.get(d.id) || 0;
            if (dl === 0)
                continue;
            // term frequency of each query term in this doc
            const tf = new Map();
            for (const t of d.tokens)
                if (qSet.has(t))
                    tf.set(t, (tf.get(t) || 0) + 1);
            if (tf.size === 0)
                continue;
            let score = 0;
            for (const [term, freq] of tf) {
                const df = this.df.get(term) || 0;
                // BM25 idf with +1 to keep it non-negative
                const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
                const denom = freq + K1 * (1 - B + B * (dl / (this.avgdl || 1)));
                score += idf * ((freq * (K1 + 1)) / denom);
            }
            hits.push({ id: d.id, score });
        }
        hits.sort((a, b) => b.score - a.score);
        return hits;
    }
}
exports.Bm25Index = Bm25Index;
