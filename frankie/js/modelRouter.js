// ── Model router ──────────────────────────────────────────────────────────────
// Routes each query to a model. Previously split high-confidence queries to
// Haiku on the theory that "KB has the answer, cheap synthesis is fine" — see
// git history for the old logic. Retired 2026-09-14: verified live that Haiku
// fabricates precise facts (category lists, acronym expansions) even when the
// correct source chunk is sitting in its own context — it paraphrases instead
// of quoting, which is the one thing this product cannot tolerate being wrong
// about. Rene's call: consistent, source-grounded answers over the cost saving.
// Every Claude-routed query now goes to Sonnet. Keeping MODELS.haiku exported
// (unused by this router) since other tools in this codebase (cqp-drawer.js,
// ncr-drawer.js, etc.) still reference the Haiku model id directly for their
// own, lower-stakes generation tasks — this change does not touch those.

export const MODELS = {
    haiku:  'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-6'
};

/**
 * @param {number}  confidence   Normalised KB confidence 0–1 (unused now — kept
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
