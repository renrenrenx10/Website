// ── ConfigManager ─────────────────────────────────────────────────────────────
// Centralised configuration: model selection, retrieval settings, feature flags.
// API keys are now held as Cloudflare Worker secrets — not stored client-side.

export class ConfigManager {
    // ── Storage helpers (kept for non-key values) ─────────────────────────

    static get(key, defaultValue = '') {
        return localStorage.getItem(key) ?? defaultValue;
    }

    static set(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.warn('ConfigManager: localStorage write failed', e);
        }
    }

    static getBool(key, defaultValue = false) {
        const stored = localStorage.getItem(key);
        if (stored === null) return defaultValue;
        return stored === 'true';
    }

    static remove(key) {
        localStorage.removeItem(key);
    }

    // ── API Keys — always resolved via Cloudflare Worker ─────────────────
    // Return a non-empty sentinel so any key-presence checks still pass.

    static get claudeApiKey() { return 'worker'; }
    static get groqApiKey()   { return 'worker'; }

    static get claudeModel() {
        // Self-heal (2026-09-09): 'claude-sonnet-4-20250514' was Anthropic's
        // dated snapshot ID for what's now aliased 'claude-sonnet-4-6'. That
        // snapshot was deprecated 2026-04-14 and fully retired 2026-06-15
        // (confirmed live via platform.claude.com/docs/en/about-claude/model-deprecations).
        // A browser that saved the old dated ID before the rename would keep
        // sending a dead model forever -> Anthropic API returns 404. Same
        // pattern as the Groq self-heal below — clear it once so the new
        // default takes.
        if (ConfigManager.get('frankieClaudeModel', '') === 'claude-sonnet-4-20250514') {
            ConfigManager.remove('frankieClaudeModel');
        }
        return ConfigManager.get('frankieClaudeModel', 'claude-sonnet-4-6');
    }

    static get groqModel() {
        // Was 'llama-3.1-8b-instant' — Groq deprecated/shut it down 2026-08-16.
        // openai/gpt-oss-20b is Groq's own recommended replacement: faster,
        // cheaper, same context window. Checked live via console.groq.com/docs/deprecations, 2026-09-08.
        // Self-heal: a browser that already has the dead model saved from
        // SCC Settings (or an older session) would otherwise keep overriding
        // this new default forever — clear it once so the new default takes.
        if (ConfigManager.get('frankieGroqModel', '') === 'llama-3.1-8b-instant') {
            ConfigManager.remove('frankieGroqModel');
        }
        return ConfigManager.get('frankieGroqModel', 'openai/gpt-oss-20b');
    }

    // ── Feature flags — on by default, SCC-controlled via localStorage ───────
    // localStorage value 'false' (string) disables; anything else (or absent) = enabled.

    static get useClaude() { return localStorage.getItem('frankieClaudeEnabled') !== 'false'; }
    static get useGroq()   { return localStorage.getItem('frankieGroqEnabled')   !== 'false'; }

    static get tier() {
        return ConfigManager.get('frankieTier', 'free');
    }

    // ── Retrieval settings ────────────────────────────────────────────────

    static get maxSources() { return 5; }
    static get confidenceThreshold() { return 0.7; }
}

// ── Backwards-compatible CONFIG object ───────────────────────────────────────

export const CONFIG = {
    get claudeApiKey()          { return ConfigManager.claudeApiKey; },
    get claudeModel()           { return ConfigManager.claudeModel; },
    get groqApiKey()            { return ConfigManager.groqApiKey; },
    get groqModel()             { return ConfigManager.groqModel; },
    get maxSources()            { return ConfigManager.maxSources; },
    get confidenceThreshold()   { return ConfigManager.confidenceThreshold; },
    modelMode: 'hybrid'
};

export function refreshConfig() { return CONFIG; }
