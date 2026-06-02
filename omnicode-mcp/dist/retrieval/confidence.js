"use strict";
// ───────────────────────────────────────────────────────────────────────────
// Calibrated retrieval confidence — ported from jcodemunch's
// retrieval/confidence.py.
//
// A single 0–1 score summarizing how trustworthy a ranked result list is, so
// an agent can decide whether to trust the top hit or widen the search.
//
// confidence = gap × strength × identity × freshness
//   gap       — top-1 vs top-2 relative score gap (1 = top dominates)
//   strength  — soft squash of the top-1 absolute score (0 score → 0)
//   identity  — 1.0 exact-name hit · 0.7 unknown · 0.6 none
//   freshness — 1.0 fresh · 0.6 stale
// ───────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeConfidence = computeConfidence;
// Theoretical max WRR score (a symbol ranked #1 in every default channel):
// (2.0 + 1.0 + 0.8 + 0.4) / (60 + 0) ≈ 0.07. Used to normalize "strength".
const STRENGTH_SCALE = 0.05;
function computeConfidence(scores, opts = {}) {
    const { isStale = false, hasIdentityMatch = null } = opts;
    const top1 = scores.length > 0 ? scores[0] : 0;
    const top2 = scores.length > 1 ? scores[1] : 0;
    // gap: how much the top result dominates the runner-up
    const gap = top1 > 0 ? Math.max(0, Math.min(1, (top1 - top2) / top1)) : 0;
    // strength: soft saturating squash of the absolute top score (0 → 0, large → 1)
    const strength = top1 > 0 ? 1 - Math.exp(-top1 / STRENGTH_SCALE) : 0;
    const identity = hasIdentityMatch === true ? 1.0 : hasIdentityMatch === null ? 0.7 : 0.6;
    const freshness = isStale ? 0.6 : 1.0;
    const components = { gap, strength, identity, freshness };
    const confidence = gap * strength * identity * freshness;
    return { confidence: Math.round(confidence * 1000) / 1000, components };
}
