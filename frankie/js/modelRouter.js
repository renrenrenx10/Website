// ── Model router ──────────────────────────────────────────────────────────────
// Routes each Claude-eligible query to Sonnet. History below for context on
// why — this file has gone back and forth once already; this is the settled
// position.
//
// 2026-09-14: Removed Haiku from routing entirely after live testing showed
// it fabricating precise facts (category lists, acronym expansions) even
// with the correct source chunk in context.
// 2026-09-15: Restored Haiku for high-confidence queries after two root
// causes were fixed (a retrieval-scoring bug, and a stricter "Precision
// rule" in claude.js's system prompt) — worth retesting since both fixes
// apply regardless of which model synthesises the answer.
// 2026-09-15 (later same day): Reverted back to Sonnet-only. Retesting with
// both fixes in place found Haiku's specific fabrications gone, but two new,
// different accuracy gaps: it compressed a multi-tier scoring rubric
// (dropping a caveat and the top band) and, separately, stated "five main
// assessment areas" while listing six items directly underneath — a plain
// self-contradiction. A content-aware escalation was built for the first
// gap (see retrieval.js's hasScoringRubric — left in place, unused by this
// router, in case Haiku is reconsidered later) but the second gap isn't
// something a targeted rule can catch, and Rene's call was that F4N
// guidance has to be right, always — measured live cost difference between
// the two models turned out to be about $0.01/query either way, not
// something worth trading accuracy for. Every Claude-eligible query goes to
// Sonnet.

export const MODELS = {
    haiku:  'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-6'
};

/**
 * @param {number}  confidence   Normalised KB confidence 0-1 (unused — kept
 *                                in the signature so callers don't need changing)
 * @param {boolean} claudeEnabled
 * @returns {{ route: string, model: string }}
 */
export function routeModel(confidence, claudeEnabled) {
    if (!claudeEnabled)    return { route: 'local',  model: null };
    if (confidence === 0)  return { route: 'local',  model: null };

    return { route: 'claude', model: MODELS.sonnet };
}

/**
 * Human-readable label for the model tag in the chat UI.
 */
export function modelLabel(model) {
    if (!model) return 'local KB';
    if (model.includes('haiku'))  return 'Claude Haiku';
    if (model.includes('sonnet')) return 'Claude Sonnet';
    return model;
}
