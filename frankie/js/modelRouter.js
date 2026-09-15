// ── Model router ──────────────────────────────────────────────────────────────
// Routes each query to the right model based on KB confidence score.
//
// Strategy:
//   high confidence (>= 0.6)  -> Haiku   - KB has the answer; cheap synthesis
//   medium confidence (0.3-0.6) -> Sonnet - needs more reasoning with partial context
//   low confidence (< 0.3)    -> Sonnet - weakest context, needs best model to be useful
//   no results                -> local   - no LLM can help without source material
//
// Restored 2026-09-15. Retired 2026-09-14 after live testing showed Haiku
// fabricating precise facts (category lists, acronym expansions) even with
// the correct source chunk in context. Two independent fixes have landed
// since: the "Precision rule" in claude.js's SHARED_KNOWLEDGE (require exact
// quoting of names/figures, say "not confident" rather than guess), and the
// HANDBOOK_BOOST scoping fix in retrieval.js (a broad handbook chapter can no
// longer outrank a specific, correct match purely from the boost multiplier).
// Re-enabling Haiku now to test whether high-confidence routing holds up
// with a genuinely correct source chunk and the precision rule doing the
// same enforcement work regardless of which model is synthesising. If live
// testing shows Haiku still drifting even with both fixes in place, revert
// this file to route every Claude-eligible query to Sonnet — see git history
// for that version (commit 4afab37).
//
// This keeps costs low (~70% Haiku) while reserving Sonnet for the queries
// where it actually makes a difference.

export const MODELS = {
    haiku:  'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-6'
};

/**
 * @param {number}  confidence    Normalised KB confidence 0-1
 * @param {boolean} claudeEnabled
 * @param {boolean} [forceSonnet] Bypass confidence-based routing and use
 *                                Sonnet regardless. Set this when the
 *                                retrieved sources contain content Haiku is
 *                                known to handle less reliably even with
 *                                correct retrieval — currently: a multi-tier
 *                                scoring rubric (see hasScoringRubric() in
 *                                retrieval.js). Live testing 2026-09-15 found
 *                                Haiku compresses rubric bands (dropping a
 *                                caveat, omitting the top tier) in a way
 *                                that changes what the rubric means, even
 *                                though it no longer invents wrong numbers
 *                                outright. This keeps Haiku as the default
 *                                for the bulk of traffic while routing this
 *                                specific, previously-hallucinating output
 *                                type to Sonnet automatically.
 * @returns {{ route: string, model: string }}
 */
export function routeModel(confidence, claudeEnabled, forceSonnet) {
    if (!claudeEnabled)    return { route: 'local',  model: null };
    if (confidence === 0)  return { route: 'local',  model: null };

    if (forceSonnet)       return { route: 'claude', model: MODELS.sonnet };
    if (confidence >= 0.6) return { route: 'claude', model: MODELS.haiku };
    // medium or low confidence — use Sonnet for better reasoning with weak context
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
