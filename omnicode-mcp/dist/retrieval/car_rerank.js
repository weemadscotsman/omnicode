"use strict";
// ───────────────────────────────────────────────────────────────────────────
// C.A.R — Context-Adaptive Retrieval (Phase One)
//
// A lightweight session-aware reranker that runs AFTER Weighted Reciprocal
// Rank (WRR) fusion and BEFORE final sorting. It reads recent repo-scoped
// memory events (query, symbol_access, file_access, context_pull, task_set)
// and applies small score multipliers to the fused candidates so the agent
// sees symbols it has recently touched ranked above equally-good candidates
// it has not.
//
// Design contract (Phase One, deliberately simple):
//   - Does not modify WRR fusion or per-channel weights.
//   - Total C.A.R boost is CAPPED at 35% of the top fused score, so a
//     stale context cannot hijack search results.
//   - Each individual signal is decayed by age (half-life 30 minutes, no
//     contribution after 6 hours).
//   - Candidates that carry a `requires_runtime` resolution state are
//     demoted by 25% to surface compile-time-friendly candidates first;
//     the resolution flag is preserved on the result so the user still
//     sees the warning.
//   - C.A.R is OPT-IN by default. Pass `car: true` in the tool args to
//     apply it. `car: false` (or absent) returns the original WRR order.
//   - Explanations are only attached when `debug: true`. Default payload
//     byte size is unchanged.
//
// One memory store, append-only, repo-scoped (session_memory.ts). This
// module is read-only over that store — it never writes events itself.
// ───────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyCarRerank = applyCarRerank;
const session_memory_1 = require("../engine/session_memory");
const DEFAULTS = {
    halfLifeMs: 30 * 60 * 1000,
    maxAgeMs: 6 * 60 * 60 * 1000,
    cap: 0.35,
    runtimePenalty: 0.25,
    limit: 200,
};
function ageDecay(ageMs, halfLifeMs, maxAgeMs) {
    if (ageMs < 0)
        return 0;
    if (ageMs > maxAgeMs)
        return 0;
    // exponential decay: 1.0 at t=0, 0.5 at halfLife, approaching 0
    return Math.pow(0.5, ageMs / halfLifeMs);
}
function tokenizeQuery(q) {
    // Split on any non-alphanumeric boundary INCLUDING underscore, so
    // `handle_login` tokenises into `handle` and `login` (matching the way
    // a human searches for either half).
    return (q || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2);
}
function applyCarRerank(fused, repoPath, options = {}) {
    const now = options.now ?? Date.now();
    const halfLife = options.halfLifeMs ?? DEFAULTS.halfLifeMs;
    const maxAge = options.maxAgeMs ?? DEFAULTS.maxAgeMs;
    const cap = options.cap ?? DEFAULTS.cap;
    const runtimePenalty = options.runtimePenalty ?? DEFAULTS.runtimePenalty;
    const eventLimit = options.limit ?? DEFAULTS.limit;
    const wantDebug = options.debug === true;
    const wantCar = options.car === true;
    // No-op fast paths. C.A.R must be explicit; the bench-child harness and
    // production callers can opt in. car=false → byte-exact parity with
    // pre-C.A.R behavior.
    const topFused = fused[0]?.score ?? 0;
    const capAbs = topFused * cap;
    if (!wantCar || fused.length === 0) {
        return {
            hits: fused,
            applied: false,
            top_fused_score: topFused,
            cap_relative: capAbs,
            boosts_total: 0,
            debug: wantDebug ? [] : undefined,
        };
    }
    // Read recent events. C.A.R only consumes the 5 car_* event types; other
    // memory events (handoff, benchmark, etc.) are ignored on purpose.
    const events = (0, session_memory_1.readRecentMemory)(repoPath, eventLimit).filter((e) => [
        'query',
        'symbol_access',
        'file_access',
        'context_pull',
        'task_set',
    ].includes(e.type));
    // Index recent signals by candidate attribute for O(1) lookup.
    const recentSymbolIds = new Set();
    const recentFilePaths = new Set();
    let recentQueryTokens = new Set();
    let lastTaskSet = null;
    let contextPulls = 0;
    for (const e of events) {
        const age = now - new Date(e.ts).getTime();
        if (age > maxAge)
            continue;
        if (e.type === 'symbol_access' && e.data?.symbol_id) {
            recentSymbolIds.add(String(e.data.symbol_id));
        }
        else if (e.type === 'file_access' && e.data?.path) {
            recentFilePaths.add(String(e.data.path));
        }
        else if (e.type === 'query' && e.data?.query) {
            const toks = tokenizeQuery(String(e.data.query));
            recentQueryTokens = new Set([...recentQueryTokens, ...toks]);
        }
        else if (e.type === 'task_set') {
            // Most recent task_set wins (events are time-ordered, this iterates
            // oldest→newest so the last assignment is the most recent).
            lastTaskSet = e;
        }
        else if (e.type === 'context_pull') {
            contextPulls += 1;
        }
    }
    // Pre-compute a representative top fused score to scale absolute boost.
    // Boosts are computed as additive deltas in the fused score space, then
    // capped to 35% of `topFused` per-candidate (sum-cap is enforced by
    // clip-pass; per-candidate cap is the unit that matters for ranking).
    const debugEntries = [];
    let boostsTotal = 0;
    const reranked = fused.map((cand) => {
        const reasons = [];
        let boost = 0;
        // (a) Exact recent symbol — strong signal
        if (cand.symbol_id && recentSymbolIds.has(cand.symbol_id)) {
            // find the most recent matching event to compute age
            const evt = findMostRecent(events, (e) => e.type === 'symbol_access' && e.data?.symbol_id === cand.symbol_id);
            const age = evt ? now - new Date(evt.ts).getTime() : 0;
            const decayed = ageDecay(age, halfLife, maxAge);
            const signal = 0.20 * decayed; // up to +0.20 of topFused
            boost += signal;
            reasons.push(`recent_symbol(+${signal.toFixed(3)},age=${Math.round(age / 1000)}s)`);
        }
        // (b) Same recent file — mild signal
        if (cand.file_path && recentFilePaths.has(cand.file_path)) {
            const evt = findMostRecent(events, (e) => e.type === 'file_access' && e.data?.path === cand.file_path);
            const age = evt ? now - new Date(evt.ts).getTime() : 0;
            const decayed = ageDecay(age, halfLife, maxAge);
            const signal = 0.10 * decayed;
            boost += signal;
            reasons.push(`recent_file(+${signal.toFixed(3)},age=${Math.round(age / 1000)}s)`);
        }
        // (c) Same query family — mild signal (symbol_name token overlap with recent queries)
        if (recentQueryTokens.size > 0 && cand.symbol_name) {
            const symTokens = new Set(tokenizeQuery(cand.symbol_name));
            let overlap = 0;
            for (const t of recentQueryTokens)
                if (symTokens.has(t))
                    overlap++;
            if (overlap > 0) {
                const signal = 0.05 * Math.min(overlap, 3);
                boost += signal;
                reasons.push(`query_overlap(+${signal.toFixed(3)},n=${overlap})`);
            }
        }
        // (d) Current task matches symbol intent — mild boost
        if (lastTaskSet && cand.intent_score && cand.intent_score > 0) {
            const taskData = (lastTaskSet.data || {});
            const taskKinds = Array.isArray(taskData.kinds) ? taskData.kinds : [];
            const symKind = cand.kind;
            if (symKind && taskKinds.includes(symKind)) {
                const signal = 0.05 * cand.intent_score;
                boost += signal;
                reasons.push(`task_kind_match(+${signal.toFixed(3)})`);
            }
        }
        // (e) High intent score — mild boost (without task data, just the raw
        // intent score still tells us the agent thinks this matters)
        if (!lastTaskSet && cand.intent_score && cand.intent_score > 0.5) {
            const signal = 0.03 * cand.intent_score;
            boost += signal;
            reasons.push(`high_intent(+${signal.toFixed(3)})`);
        }
        // (f) Resolution safety — DEMOTE requires_runtime unless the recent
        // context_pull count for this repo is high (the agent is working
        // runtime, so runtime-required candidates are on-topic).
        if (cand.resolution_state === 'requires_runtime' && contextPulls < 3) {
            const penalty = topFused * runtimePenalty;
            boost -= penalty;
            reasons.push(`runtime_demote(-${penalty.toFixed(3)})`);
        }
        // Per-candidate cap: total additive boost cannot exceed capAbs in
        // either direction. (Positive boost is bounded; negative penalty is
        // also bounded so a single requires_runtime candidate can't tank the
        // entire ranking.)
        const cappedBoost = Math.max(-capAbs, Math.min(capAbs, boost));
        const wasClipped = cappedBoost !== boost;
        if (wasClipped && boost !== 0)
            reasons.push(`cap_clip(orig=${boost.toFixed(3)}->${cappedBoost.toFixed(3)})`);
        const finalScore = cand.score + cappedBoost;
        boostsTotal += Math.abs(cappedBoost);
        if (wantDebug) {
            debugEntries.push({
                candidate_id: cand.id,
                base_score: cand.score,
                final_score: finalScore,
                total_boost: cappedBoost,
                cap_applied: wasClipped,
                reasons,
            });
        }
        return { ...cand, score: finalScore };
    });
    // Re-sort by final score. Stable on tie to avoid gratuitous reorder.
    reranked.sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        const aIdx = fused.findIndex((f) => f.id === a.id);
        const bIdx = fused.findIndex((f) => f.id === b.id);
        return aIdx - bIdx;
    });
    return {
        hits: reranked,
        applied: true,
        top_fused_score: topFused,
        cap_relative: capAbs,
        boosts_total: boostsTotal,
        debug: wantDebug ? debugEntries : undefined,
    };
}
function findMostRecent(events, pred) {
    for (let i = events.length - 1; i >= 0; i--) {
        if (pred(events[i]))
            return events[i];
    }
    return null;
}
