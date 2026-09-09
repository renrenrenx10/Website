// ── Reactors KB Search  v1.0 ─────────────────────────────────────────────
// Standalone search engine over the "reactors" KB partition (61k+ chunks of
// real DCD/FSAR/PCSR/GDA reactor design-document text — see
// build_frankie_reactors_kb.py). This partition was retired from Frankie's
// default chat retrieval for the F4N-member soft launch (retrieval.js,
// searchKnowledgeBase()'s hardcoded `nuclear = false`) and is surfaced here
// instead, as its own NucColpedia section: search in, scored snippet
// results out — never the full document.
//
// Deliberately independent of retrieval.js — does not import from it and
// does not touch loadKnowledgeBase()/searchKnowledgeBase(), so this module
// can't perturb the main chat's default retrieval path. WORKER_URL/
// authHeaders() are duplicated here rather than imported, matching the
// existing pattern in claude.js/groq.js.
//
// Two-stage search, chosen over reusing retrieval.js's per-chunk regex scan
// as-is: at 61k chunks / ~22M words, scanning the full corpus with a fresh
// RegExp per token per chunk on every query is too slow to feel responsive.
// Stage 1 narrows 61k chunks to ~150 candidates with O(1) Set lookups
// (built once, at load time). Stage 2 only re-scores those candidates with
// the exact frequency-weighted logic retrieval.js uses, so ranking quality
// matches. Multi-word queries are tokenized and matched per-word (OR), not
// as a literal phrase — the same class of bug already fixed in Plant
// Explorer's search (see CHANGELOG) would otherwise silently zero out any
// multi-word query here too.
//
// Usage:
//   await ReactorsKbSearch.ensureLoaded(onProgress?)   → fetches + indexes once, caches after
//   ReactorsKbSearch.search(query, { reactorType, docCategory, discipline }, maxResults)
//   ReactorsKbSearch.getFacets()  → { reactorTypes, docCategories, disciplines } from loaded data
//   ReactorsKbSearch.isLoaded()

(function () {
    'use strict';

    const WORKER_URL = 'https://ch.rene-dorset.workers.dev';

    function authHeaders() {
        const token = localStorage.getItem('frankieUserToken');
        return token ? { 'Authorization': `Bearer ${token}` } : {};
    }

    const CANDIDATE_POOL = 150; // how many Stage-1 candidates get exact Stage-2 scoring

    let chunks       = null;  // raw chunk array
    let tokenSets     = null;  // Array<Set<string>> — parallel to chunks, dedup'd tokens per chunk
    let searchables   = null;  // Array<string> — parallel to chunks, lowercase searchable text (for Stage 2 scoring)
    let facets        = null;  // { reactorTypes, docCategories, disciplines }
    let loadingPromise = null;

    function tokenize(text) {
        return (text || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean);
    }

    function buildSearchable(chunk) {
        return [
            chunk.text, chunk.section, chunk.source_file,
            chunk.reactor_type, chunk.doc_category, chunk.discipline,
        ].filter(Boolean).join(' ').toLowerCase();
    }

    function buildIndex() {
        tokenSets   = new Array(chunks.length);
        searchables = new Array(chunks.length);
        const reactorTypes  = new Set();
        const docCategories = new Set();
        const disciplines   = new Set();

        for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            const searchable = buildSearchable(c);
            searchables[i] = searchable;
            tokenSets[i]   = new Set(tokenize(searchable));
            if (c.reactor_type) reactorTypes.add(c.reactor_type);
            if (c.doc_category) docCategories.add(c.doc_category);
            if (c.discipline)   disciplines.add(c.discipline);
        }

        facets = {
            reactorTypes:  [...reactorTypes].sort(),
            docCategories: [...docCategories].sort(),
            disciplines:   [...disciplines].sort(),
        };
    }

    // ── Load (lazy, cached) ──────────────────────────────────────────────────

    async function ensureLoaded(onProgress) {
        if (chunks) return true;
        if (loadingPromise) return loadingPromise;

        loadingPromise = (async () => {
            onProgress?.('fetching');
            const res = await fetch(`${WORKER_URL}/kb/frankie_reactors_kb.json`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            chunks = Array.isArray(data) ? data : (data.chunks || []);

            onProgress?.('indexing');
            buildIndex();

            console.log(`Frankie: reactors KB loaded + indexed — ${chunks.length.toLocaleString()} chunks`);
            return true;
        })();

        try {
            return await loadingPromise;
        } catch (e) {
            loadingPromise = null; // allow retry on failure
            throw e;
        }
    }

    function isLoaded() {
        return !!chunks;
    }

    function getFacets() {
        return facets || { reactorTypes: [], docCategories: [], disciplines: [] };
    }

    // ── Exact keyword score (same shape as retrieval.js's keywordScore) ──────

    function exactScore(tokens, searchable) {
        return tokens.reduce((score, token) => {
            const matches = searchable.match(new RegExp(`\\b${token}\\b`, 'g'));
            return score + (matches ? matches.length : 0);
        }, 0);
    }

    // ── Search ────────────────────────────────────────────────────────────────

    function search(query, filters = {}, maxResults = 20) {
        if (!chunks) return [];
        const tokens = [...new Set(tokenize(query))];
        if (!tokens.length) return [];

        const { reactorType, docCategory, discipline } = filters;

        // Stage 1: cheap Set-lookup pass over the full corpus — count how many
        // distinct query tokens each chunk contains, apply facet filters.
        const candidates = [];
        for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            if (reactorType && c.reactor_type !== reactorType) continue;
            if (docCategory && c.doc_category !== docCategory) continue;
            if (discipline && c.discipline !== discipline) continue;

            let hits = 0;
            const set = tokenSets[i];
            for (const t of tokens) if (set.has(t)) hits++;
            if (hits > 0) candidates.push({ i, hits });
        }

        candidates.sort((a, b) => b.hits - a.hits);
        const pool = candidates.slice(0, CANDIDATE_POOL);

        // Stage 2: exact frequency-weighted scoring, same logic as retrieval.js,
        // but only over the narrowed candidate pool.
        const scored = pool.map(({ i }) => {
            const score = exactScore(tokens, searchables[i]);
            return { ...chunks[i], score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, maxResults);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    window.ReactorsKbSearch = { ensureLoaded, isLoaded, getFacets, search };

}());
