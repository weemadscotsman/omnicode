"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchSymbols = searchSymbols;
const db_1 = require("../store/db");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const bm25_1 = require("../retrieval/bm25");
const signal_fusion_1 = require("../retrieval/signal_fusion");
const confidence_1 = require("../retrieval/confidence");
const car_rerank_1 = require("../retrieval/car_rerank");
const session_memory_1 = require("../engine/session_memory");
const embeddings_1 = require("../engine/embeddings");
const ocap_1 = require("../engine/ocap");
function isIndexedFileStale(symbol) {
    if (!symbol.indexed_at)
        return true;
    try {
        const normalized = symbol.indexed_at.includes('T')
            ? symbol.indexed_at
            : `${symbol.indexed_at.replace(' ', 'T')}Z`;
        const indexedAt = new Date(normalized).getTime();
        if (!Number.isFinite(indexedAt))
            return true;
        const modifiedAt = fs_1.default.statSync(symbol.path).mtimeMs;
        return modifiedAt > indexedAt + 1000;
    }
    catch {
        return true;
    }
}
/**
 * Build the identity channel: symbols whose NAME matches the query, ranked by
 * match tier (exact > case-insensitive exact > prefix > substring), then by
 * structural importance as a tiebreaker.
 */
function identityChannel(query, symbols) {
    const q = query.trim();
    const ql = q.toLowerCase();
    const exactIds = new Set();
    const tiered = [];
    for (const s of symbols) {
        const n = s.name;
        const nl = n.toLowerCase();
        let tier = -1;
        if (n === q)
            tier = 0;
        else if (nl === ql)
            tier = 1;
        else if (nl.startsWith(ql))
            tier = 2;
        else if (nl.includes(ql))
            tier = 3;
        if (tier < 0)
            continue;
        if (tier <= 1)
            exactIds.add(s.id);
        tiered.push({ id: s.id, tier, imp: s.importance_score || 0 });
    }
    tiered.sort((a, b) => (a.tier - b.tier) || (b.imp - a.imp));
    return { ranked: tiered.map((t) => t.id), exactIds };
}
function symbolSemanticText(symbol) {
    return [symbol.name, symbol.kind, path_1.default.basename(symbol.path), symbol.snippet || ''].join(' ');
}
async function similarityChannel(query, symbols, lexicalRanked, identityRanked) {
    if (!(await (0, embeddings_1.semanticEmbeddingsAvailable)()))
        return [];
    const queryEmbedding = await (0, embeddings_1.getSemanticEmbedding)(query);
    if (!queryEmbedding)
        return [];
    const cap = Math.max(0, Number(process.env.OMNICODE_SIMILARITY_CANDIDATE_LIMIT || 2500));
    let candidateSymbols = symbols;
    if (cap > 0 && symbols.length > cap) {
        const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]));
        const selected = new Map();
        for (const id of [...identityRanked, ...lexicalRanked]) {
            const symbol = byId.get(id);
            if (symbol)
                selected.set(symbol.id, symbol);
        }
        for (const symbol of [...symbols].sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))) {
            if (selected.size >= cap)
                break;
            selected.set(symbol.id, symbol);
        }
        candidateSymbols = [...selected.values()];
    }
    // Minimum cosine to count as a semantic match. Without this, a no-match query
    // ("zzz_does_not_exist") still pulls weak nearest neighbours (any score > 0),
    // breaking the "no results" contract and polluting ranking. MiniLM scores
    // related text ~0.4–0.7 and unrelated near/below 0, so ~0.3 keeps real matches
    // and drops noise. Tunable via OMNICODE_SIMILARITY_MIN_SCORE.
    const minScore = Number(process.env.OMNICODE_SIMILARITY_MIN_SCORE ?? 0.3);
    const scored = [];
    for (const symbol of candidateSymbols) {
        const symbolEmbedding = await (0, embeddings_1.getSemanticEmbedding)(symbolSemanticText(symbol));
        if (!symbolEmbedding)
            continue;
        const score = (0, embeddings_1.cosineSimilarity)(queryEmbedding, symbolEmbedding);
        if (score >= minScore)
            scored.push({ id: symbol.id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map((hit) => hit.id);
}
async function searchSymbols(repoPath, query, max_results, _fuzzy_threshold, options) {
    const db = (0, db_1.initDb)(repoPath);
    const symbols = db.prepare(`
    SELECT s.id, s.name, s.kind, s.line, s.snippet, f.path, f.indexed_at,
           COALESCE(s.importance_score, 0) AS importance_score
    FROM symbols s
    JOIN files f ON s.file_id = f.id
  `).all();
    if (symbols.length === 0) {
        db.close();
        return { result: "No symbols indexed yet." };
    }
    const byId = new Map(symbols.map((s) => [s.id, s]));
    // â”€â”€ Channel 1: identity (exact/prefix/substring name match) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { ranked: identityRanked, exactIds } = identityChannel(query, symbols);
    // â”€â”€ Channel 2: lexical (real BM25 over name + path basename tokens) â”€â”€â”€â”€â”€â”€â”€
    const bm25 = new bm25_1.Bm25Index(symbols.map((s) => ({
        id: s.id,
        tokens: [...(0, bm25_1.tokenize)(s.name), ...(0, bm25_1.tokenize)(path_1.default.basename(s.path)), ...(0, bm25_1.tokenize)(s.kind)],
    })));
    const lexicalRanked = bm25.search(query).map((h) => h.id);
    const similarityRanked = await similarityChannel(query, symbols, lexicalRanked, identityRanked);
    // Candidate pool = anything matched by identity, lexical, or real semantic
    // similarity. Structural is a tiebreaker over this pool, never a source of
    // unrelated central symbols by itself.
    const candidates = new Set([...identityRanked, ...lexicalRanked, ...similarityRanked]);
    if (candidates.size === 0) {
        db.close();
        return { result: "No symbols found matching query." };
    }
    // â”€â”€ Channel 3: structural (PageRank-derived importance) over candidates â”€â”€â”€
    const structuralRanked = [...candidates]
        .map((id) => byId.get(id))
        .sort((a, b) => (b.importance_score || 0) - (a.importance_score || 0))
        .map((s) => s.id);
    // â”€â”€ Fuse via Weighted Reciprocal Rank â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const channels = [
        { name: 'identity', rankedIds: identityRanked },
        { name: 'lexical', rankedIds: lexicalRanked },
        ...(similarityRanked.length > 0 ? [{ name: 'similarity', rankedIds: similarityRanked }] : []),
        { name: 'structural', rankedIds: structuralRanked },
    ];
    const fused = (0, signal_fusion_1.fuse)(channels);
    // ── C.A.R Phase One ─────────────────────────────────────────────────
    // Record the query event (lightweight, one line per call into the
    // append-only session memory). This is what C.A.R reads on the next
    // search to apply the recent-symbol / recent-file / query-family boost.
    try {
        (0, session_memory_1.appendMemoryEvent)(repoPath, {
            type: 'query',
            summary: `search_symbols query: ${query}`.slice(0, 1000),
            data: { query, ts_kind: 'search_symbols' },
            source: 'search_symbols',
        });
    }
    catch {
        // Memory is best-effort. A failed append must not break retrieval.
    }
    // Run C.A.R after WRR fusion and before confidence/limit. The fused
    // array is converted to a candidate-friendly shape (symbol_id, file_path,
    // symbol_name, resolution_state) so the rerank engine can use them.
    const carCandidates = fused.map((h) => {
        const sym = byId.get(h.id);
        return {
            id: h.id,
            score: h.score,
            symbol_id: sym?.id,
            symbol_name: sym?.name,
            file_path: sym?.path,
            kind: sym?.kind,
            // Resolution safety: surfaced via the joined symbol view. If the
            // symbol row carries a runtime-required or unsafe marker, C.A.R
            // must demote it unless the agent is in a runtime context.
            resolution_state: undefined,
        };
    });
    const carResult = (0, car_rerank_1.applyCarRerank)(carCandidates, repoPath, {
        car: options?.car === true,
        debug: options?.debug === true,
    });
    const top = carResult.hits.slice(0, max_results || 50);
    // â”€â”€ Calibrated confidence over the fused score distribution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const hasIdentityMatch = top.length > 0 ? exactIds.has(top[0].id) : false;
    const topSymbol = top.length > 0 ? byId.get(top[0].id) : null;
    const isStale = topSymbol ? isIndexedFileStale(topSymbol) : true;
    const { confidence, components } = (0, confidence_1.computeConfidence)(fused.map((f) => f.score), { hasIdentityMatch, isStale });
    const lines = top.map((h) => {
        const s = byId.get(h.id);
        return `[${s.kind}] ${s.name} (${s.path}:${s.line})`;
    });
    const pct = (confidence * 100).toFixed(0);
    const footer = `\n— confidence ${pct}% ` +
        `(gap ${components.gap.toFixed(2)} · strength ${components.strength.toFixed(2)} · ` +
        `identity ${components.identity.toFixed(2)} · freshness ${components.freshness.toFixed(2)} · ` +
        `channels: ${channels.map((channel) => channel.name).join('+')})` +
        (carResult.applied ? ` · C.A.R=on` : ` · C.A.R=off`);
    const resolvedFormat = (0, ocap_1.resolveOcapFormat)(options?.format, top.length);
    let payload;
    if (resolvedFormat === 'ocap') {
        const ocap = (0, ocap_1.makeOcapBuilder)('search_symbols', ['name', 'kind', 'path', 'line', 'score']);
        for (const h of top) {
            const s = byId.get(h.id);
            const kindId = ocap.intern('kind', s.kind);
            const pathId = ocap.intern('path', s.path);
            ocap.push([s.name, kindId, pathId, s.line, Number(h.score.toFixed(4))]);
        }
        ocap.setFooter('query', query.slice(0, 80));
        ocap.setFooter('confidence', pct);
        ocap.setFooter('car', carResult.applied ? 'on' : 'off');
        ocap.setFooter('channels', channels.map((c) => c.name).join('+'));
        payload = { result: ocap.toText() };
    }
    else {
        payload = { result: lines.join('\n') + footer };
    }
    // Only attach the per-candidate boost breakdown when the caller asked
    // for it. Default byte payload is unchanged.
    if (carResult.applied && options?.debug === true && carResult.debug) {
        payload._car_debug = {
            top_fused_score: carResult.top_fused_score,
            cap_relative: carResult.cap_relative,
            boosts_total: carResult.boosts_total,
            entries: carResult.debug,
        };
    }
    db.close();
    return payload;
}
