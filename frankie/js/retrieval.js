
// ── Knowledge base retrieval ──────────────────────────────────────────────────
// Hybrid search: blends keyword (BM25-style) + vector (cosine similarity).
// Multi-partition: supplier, toolkit, regs, reactors.
// Graph entity boosting: known entities in query → pinned chunk IDs.

// ── Worker + auth ──────────────────────────────────────────────────────────────
// KB/vector files are no longer served as static relative paths — they live in
// a private Azure Blob container behind the Cloudflare Worker's /kb/* route,
// which requires a valid member session (see ch-proxy-worker.js, added 2026-08-03).

const WORKER_URL = 'https://ch.rene-dorset.workers.dev';

function authHeaders() {
    const token = localStorage.getItem('frankieUserToken');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

// ── Nuclear Engineering Mode (site-wide toggle, SCC-controlled) ────────────────
// SCC turns this on/off for everyone in scc.html ("Website Features" panel),
// same nr_site_settings table + key ('nuclear_mode_enabled') members.html
// already reads for the NuclearReady/Frankie-link flags. Direct REST call
// (not the supabase-js client) since this module has no other Supabase
// dependency to justify loading the library — same duplicated-constants
// convention every other Worker/Supabase-calling module in this codebase
// already follows.
const SUPABASE_URL = 'https://qkyvmtouwrzrcyagkheo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFreXZtdG91d3J6cmN5YWdraGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODQzNjMsImV4cCI6MjA5MDk2MDM2M30.gKEgkVA-VjOnS_084W79kpzOdZhFQkhFp63MAe_FTd4';

let nuclearModeCache = null; // cached for the rest of this page session once fetched

async function isNuclearModeEnabled() {
    if (nuclearModeCache !== null) return nuclearModeCache;
    try {
        const token = localStorage.getItem('frankieUserToken');
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/nr_site_settings?key=eq.nuclear_mode_enabled&select=value`,
            { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token || SUPABASE_ANON_KEY}` } }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = await res.json();
        // Fail-closed, same stance as the Frankie-link flag: an experimental,
        // staged capability stays off unless SCC has explicitly turned it on.
        nuclearModeCache = rows.length > 0 && rows[0].value === true;
    } catch (e) {
        console.warn('Frankie: nuclear_mode_enabled check failed, defaulting to off:', e);
        nuclearModeCache = false;
    }
    return nuclearModeCache;
}

// ── Partition config ──────────────────────────────────────────────────────────

const PARTITIONS = [
    // Handbook first — curated member guidance, given priority in scoring
    // below (HANDBOOK_BOOST) so a practical "how do I..." query surfaces
    // the actual handbook chapter instead of defaulting to raw supplier-
    // report evidence just because that's the only content that existed
    // in the corpus before 2026-09-08. See build_frankie_handbook_kb.py
    // and "Frankie, Recalibrated" proposal, §08.
    { kb: `${WORKER_URL}/kb/frankie_handbook_kb.json`,   vectors: `${WORKER_URL}/kb/frankie_handbook_vectors.json`,  lazy: false, name: 'handbook'  },
    { kb: `${WORKER_URL}/kb/frankie7_supplier_kb.json`,  vectors: `${WORKER_URL}/kb/frankie7_supplier_vectors.json`, lazy: false, name: 'supplier'  },
    { kb: `${WORKER_URL}/kb/frankie_toolkit_kb.json`,    vectors: `${WORKER_URL}/kb/frankie_toolkit_vectors.json`,   lazy: false, name: 'toolkit'   },
    { kb: `${WORKER_URL}/kb/frankie_regs_kb.json`,       vectors: `${WORKER_URL}/kb/frankie_regs_vectors.json`, lazy: false, name: 'regs'      },
    { kb: `${WORKER_URL}/kb/frankie_reactors_kb.json`,   vectors: null,  /* 2.1GB — graph + keyword */   lazy: true,  name: 'reactors'  },
];

const GRAPH_FILE   = `${WORKER_URL}/kb/frankie_graph.json`;
const VECTOR_DIMS  = 1536;  // all new vectors built at full 1536 dims

// Blend weight: 0 = pure keyword, 1 = pure vector. 0.6 favours semantic.
const VECTOR_WEIGHT  = 0.6;
const KEYWORD_WEIGHT = 0.4;

// Score boost for chunks pinned by graph entity match
const GRAPH_BOOST = 3.0;

// Score boost for a chunk containing an exact multi-word phrase from the
// query verbatim. Root-caused 2026-09-15 alongside the stopword fix above:
// even with stopwords stripped, single-token keyword counting still dilutes
// a precise multi-word domain phrase (e.g. "granting criteria") across a
// large corpus (11k+ regs chunks alone) where plenty of unrelated documents
// happen to contain "criteria" or "granting" individually. A short, exact
// chunk titled "Complete F4N Granting Criteria" scored below 130 other
// chunks on a live query asking for exactly that phrase, because nothing in
// the scoring model rewarded matching the whole phrase over matching its
// words separately and scattered. This only fires for genuine 2-3 word
// phrases pulled from the query that still contain real content words after
// stopword removal, and only adds — it can't zero out a stronger semantic
// match, the same discipline as HANDBOOK_BOOST's tie-breaking-only rule.
const PHRASE_BOOST = 3.0;

function extractQueryPhrases(query) {
    const words = (query || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const phrases = [];
    for (let n = 3; n >= 2; n--) {
        for (let i = 0; i + n <= words.length; i++) {
            const gram = words.slice(i, i + n);
            const nonStop = gram.filter(w => !STOPWORDS.has(w)).length;
            if (nonStop >= 2) phrases.push(gram.join(' '));
        }
    }
    return phrases;
}

// Best (longest) matching phrase only, so overlapping n-grams of the same
// hit ("granting criteria" inside a trigram and a bigram) don't stack.
function phraseBoost(phrases, chunk) {
    const searchable = ((chunk.text || '') + ' ' + (chunk.section || '')).toLowerCase();
    for (const phrase of phrases) {
        if (searchable.includes(phrase)) return PHRASE_BOOST;
    }
    return 0;
}

// Detects a compound question joining two or more distinct asks with "and"
// (e.g. "What are the granting criteria and what does SQEP stand for?").
// Root-caused 2026-09-15/16 as the remaining half of the granting-criteria/SQEP
// retrieval gap: even after the stopword fix and PHRASE_BOOST, a single flat
// top-maxSources ranking lets whichever sub-question scores higher swallow
// every result slot, starving the other sub-question's content even when a
// good chunk exists for it — the real SQEP scoring-rubric chunk ranked #10
// on this exact live query (kw=9, a solid match) but never made the default
// top-5 because five "granting criteria" chunks outscored it. This only
// detects "X and <wh-word/aux>...", so an ordinary single-topic query with an
// incidental "and" in it ("stainless steel and inconel") is left untouched.
const CLAUSE_SPLIT_RE = /\s+and\s+(?=(?:what|how|why|when|where|which|who|does|do|did|is|are|can|could|should|will|would)\b)/i;

function splitQueryClauses(query) {
    const parts = (query || '').split(CLAUSE_SPLIT_RE).map(p => p.trim()).filter(Boolean);
    return parts.length > 1 ? parts : [query];
}

// Anonymised company-submission chunks (F4N/Reports/BE, F4N/Reports/NSS —
// another supplier's assessment evidence, not guidance written for the
// reader) get demoted relative to genuine guidance content so a "how do I
// implement X" query surfaces the handbook/toolkit explanation before it
// surfaces someone else's anonymised evidence excerpt. Evidence chunks can
// still win if they're a much stronger match — this only breaks ties in
// favour of guidance. See "Frankie, Recalibrated" proposal, §08.
const REPORT_SOURCE_PREFIXES = ['F4N/Reports/BE', 'F4N/Reports/NSS'];
const REPORT_SOURCE_PENALTY = 0.55; // multiplier applied to final score
function isAnonymisedReportChunk(chunk) {
    const folder = chunk.source_folder || '';
    return REPORT_SOURCE_PREFIXES.some(p => folder.startsWith(p));
}

// Curated member handbook content — boosted rather than merely un-penalised,
// since this is the one partition written specifically to answer "how do I
// do X" questions (vs. guidance docs written for a different purpose, or
// report evidence written about a specific other company). Multiplier, not
// additive, so it scales with how strong the underlying match already is
// rather than letting a weak handbook hit outrank a strong non-handbook one.
const HANDBOOK_BOOST = 1.4;
function isHandbookChunk(chunk) {
    return chunk.category === 'handbook_guidance';
}

// Detects a multi-tier numeric scoring rubric in a chunk's text (F4N's
// standard 0 / 2 / 7 / 10 scoring bands, e.g. "0. No process... 2. Basic
// process... 7. Strong process, but occasional lapses... 10. Comprehensive,
// fully embedded", or the "Option Score: N" / "Option Description:" form
// used in question_set_structure_f4n.xlsx). Live testing 2026-09-15 found
// Haiku reliably gets names, figures and single facts right post-fix, but
// still tends to compress rubric text — e.g. dropping the caveat in a
// middle band ("occasional lapses") or omitting the top band entirely,
// changing what the rubric actually means even though no single number is
// wrong. Rather than trust Haiku on this narrow, previously-hallucinating
// output type, queries whose retrieved sources contain a rubric like this
// are always escalated to Sonnet in app.js — see routeModel()'s forceSonnet
// parameter in modelRouter.js.
const RUBRIC_TIER_PATTERN = /(?:^|\n)\s*(?:0|2|7|10)\.\s|Option Score:\s*\d/i;
export function hasScoringRubric(chunk) {
    const text = chunk.text || '';
    const matches = text.match(new RegExp(RUBRIC_TIER_PATTERN.source, 'gi')) || [];
    // Require at least 3 tier markers so a stray "2." in ordinary prose
    // doesn't trigger this — a real rubric lists multiple bands together.
    return matches.length >= 3;
}

// ── Caches ────────────────────────────────────────────────────────────────────

let kbCache        = null;   // all non-lazy chunks
let reactorsCache  = null;   // lazy-loaded reactors chunks
let vectorIndex    = null;   // Map<id, Float32Array> — supplier + toolkit only
let graphCache     = null;   // frankie_graph.json

// ── Triggers for lazy reactors load ──────────────────────────────────────────

const NUCLEAR_SIGNALS = [
    'reactor', 'nuclear', 'onr', 'nrc', 'iaea', 'gda', 'fsar', 'dcd', 'pcsr',
    'sap ', ' tag ', 'containment', 'coolant', 'pressuriser', 'fuel assembly',
    'ap1000', 'ap300', 'ap600', 'apr1400', 'abwr', 'bwrx', 'esbwr', 'nuscale',
    'rolls-royce smr', 'rr smr', 'uk epr', 'hinkley', 'us-apwr', 'us epr',
    'safety analysis', 'safety case', 'design basis', 'seismic', 'psa',
    'westinghouse', 'ge-hitachi', 'framatome', 'kepco', 'mitsubishi',
    'stainless steel', 'zircaloy', 'inconel', 'rpv', 'crdm', 'eccs',
    'wano', 'inpo', 'nei ', 'nureg',
];

function isNuclearQuery(query) {
    const ql = query.toLowerCase();
    return NUCLEAR_SIGNALS.some(s => ql.includes(s));
}

// ── Plant/component intent (routes to Plant Explorer, not the KB) ─────────────
// See "Frankie, Recalibrated" proposal, §02b: component/plant-systems questions
// ("where do the pumps sit") are better answered by Plant Explorer's structured
// per-reactor BOM data than by KB prose chunks. Reuses the entity lists below.
const PLANT_INTENT_TERMS = [
    'pump', 'valve', 'vessel', 'zone', 'building', 'where is', 'where are',
    'where does', 'located', 'commodity', 'commodities',
];

export function isPlantComponentQuery(query) {
    const ql = query.toLowerCase();
    return COMPONENT_ENTITIES.some(c => ql.includes(c))
        || MATERIAL_ENTITIES.some(m => ql.includes(m))
        || PLANT_INTENT_TERMS.some(t => ql.includes(t));
}

// ── Entity extraction from query ──────────────────────────────────────────────

const SAP_CODE_RE  = /\b(EKP|EME|ECS|ERC|ESS|ERL|FA|FB|FC|FD|FP|FS|FT|HR|LC|MS|NS|OM|PC|PE|SC|SR|SS|ST|SY|TR|TS)\.\d+(?:\.\d+)?\b/gi;
const TAG_CODE_RE  = /\bns[-\s]?tast[-\s]?gd[-\s]?\d+\b/gi;
const NUREG_RE     = /\bNUREG[-/]?\d{4}(?:[-/]\d+)?\b/gi;

const REACTOR_ALIASES = {
    'AP1000':        ['ap1000', 'ap-1000'],
    'AP300':         ['ap300', 'ap-300'],
    'AP600':         ['ap600', 'ap-600'],
    'APR1400':       ['apr1400', 'apr-1400'],
    'ABWR':          ['abwr', 'advanced boiling water'],
    'BWRX300':       ['bwrx-300', 'bwrx300', 'bwrx 300'],
    'ESBWR':         ['esbwr'],
    'NuScale_US460': ['nuscale', 'us460', 'voygr'],
    'RR_SMR':        ['rolls-royce smr', 'rr smr', 'rrsmr'],
    'UK_EPR':        ['uk epr', 'hinkley', 'edf gw'],
    'US_APWR':       ['us-apwr', 'us apwr', 'mitsubishi apwr'],
    'US_EPR':        ['us epr', 'areva epr'],
};

const F4N_ALIASES = {
    'strategy':         ['strategy & leadership', 'strategic leadership', 'sl-01'],
    'people':           ['people excellence', 'sqep', 'competency framework'],
    'ops_manufacturing':['process excellence', 'lean', '5s', 'sop', 'continuous improvement'],
    'qhse':             ['qhse', 'quality management', 'health and safety', 'iso 9001', 'iso 19443'],
    'supply_chain':     ['supply chain', 'procurement', 'supplier performance', 'social value'],
    'design_pm':        ['design & pm', 'project management', 'design review'],
};

const MATERIAL_ENTITIES = [
    'stainless steel', 'carbon steel', 'inconel', 'zircaloy', 'nickel alloy',
    'austenitic', 'ferritic', 'hastelloy', 'titanium alloy',
];

const COMPONENT_ENTITIES = [
    'reactor pressure vessel', 'rpv', 'steam generator', 'pressuriser',
    'control rod drive', 'crdm', 'eccs', 'containment structure',
    'primary circuit', 'secondary circuit', 'spent fuel pool',
    'diesel generator', 'reactor coolant pump',
];

const STANDARD_ENTITIES = [
    'iso 9001', 'iso 19443', 'iso 3834', 'rcc-m', 'asme section iii',
    'n286', 'ieee', 'iec 61513', 'en 13480',
];

function extractQueryEntities(query) {
    const entities = new Set();
    const ql = query.toLowerCase();

    // SAP codes  e.g. EKP.1, MS.4
    for (const m of query.matchAll(SAP_CODE_RE)) {
        entities.add(m[0].toUpperCase());
        entities.add(`sap:${m[0].toUpperCase()}`);
    }
    // TAG codes  e.g. ns-tast-gd-013
    for (const m of query.matchAll(TAG_CODE_RE)) {
        const norm = m[0].toLowerCase().replace(/\s+/g, '-');
        entities.add(norm);
        entities.add(`tag:${norm}`);
    }
    // NUREG numbers
    for (const m of query.matchAll(NUREG_RE)) {
        entities.add(m[0].toUpperCase());
    }
    // Reactor names
    for (const [reactorId, aliases] of Object.entries(REACTOR_ALIASES)) {
        if (aliases.some(a => ql.includes(a))) {
            entities.add(reactorId);
            entities.add(`reactor:${reactorId}`);
        }
    }
    // F4N pillars
    for (const [pillar, aliases] of Object.entries(F4N_ALIASES)) {
        if (aliases.some(a => ql.includes(a))) {
            entities.add(pillar);
            entities.add(`f4n:${pillar}`);
        }
    }
    // Materials
    for (const mat of MATERIAL_ENTITIES) {
        if (ql.includes(mat)) {
            entities.add(mat);
            entities.add(`material:${mat.replace(/ /g, '_')}`);
        }
    }
    // Components
    for (const comp of COMPONENT_ENTITIES) {
        if (ql.includes(comp)) {
            entities.add(comp);
            entities.add(`component:${comp.replace(/ /g, '_')}`);
        }
    }
    // Standards
    for (const std of STANDARD_ENTITIES) {
        if (ql.includes(std)) {
            entities.add(std);
            entities.add(`standard:${std.replace(/ /g, '_')}`);
        }
    }
    // Regulatory bodies
    for (const rb of ['ONR', 'NRC', 'IAEA', 'INPO', 'WANO', 'NEI']) {
        if (ql.includes(rb.toLowerCase())) {
            entities.add(rb);
            entities.add(`regbody:${rb}`);
        }
    }

    return [...entities];
}

// ── Graph loader ──────────────────────────────────────────────────────────────

async function loadGraph() {
    if (graphCache) return graphCache;
    try {
        const r = await fetch(GRAPH_FILE, { headers: authHeaders() });
        if (!r.ok) return null;
        graphCache = await r.json();
        console.log(`Frankie: graph loaded — ${graphCache.meta.total_nodes} nodes, ${graphCache.meta.entity_keys} entity keys`);
    } catch (e) {
        console.warn('Frankie: graph not available —', e.message);
        graphCache = null;
    }
    return graphCache;
}

// ── KB loaders ────────────────────────────────────────────────────────────────

// UK-relevant regs categories for the F4N-member launch — see "Frankie, Recalibrated"
// proposal, §02. Drops nrc_reference, wano, inpo, iaea, nei, gov_policy, cyber_security:
// none of it is what a UK F4N supplier cites. Filtered client-side for now; folding this
// into the regs KB build itself is part of the corpus rebuild plan.
const REGS_CATEGORY_ALLOWLIST = new Set(['onr_sap', 'onr_tag', 'gda_guidance', 'cyber_security']);

async function loadPartitionKb(partition) {
    try {
        const r = await fetch(partition.kb, { headers: authHeaders() });
        if (!r.ok) return [];
        const data = await r.json();
        let chunks = Array.isArray(data) ? data : (data.chunks || []);
        if (partition.name === 'regs') {
            const before = chunks.length;
            chunks = chunks.filter(c => REGS_CATEGORY_ALLOWLIST.has(c.category));
            console.log(`Frankie: regs narrowed to UK-relevant categories — ${chunks.length.toLocaleString()} of ${before.toLocaleString()} chunks`);
        }
        console.log(`Frankie: loaded ${partition.name} KB — ${chunks.length.toLocaleString()} chunks`);
        return chunks;
    } catch (e) {
        console.warn(`Frankie: failed to load ${partition.name} KB —`, e.message);
        return [];
    }
}

async function loadKnowledgeBase(includeReactors = false) {
    // Always load non-lazy partitions
    if (!kbCache) {
        const eager = PARTITIONS.filter(p => !p.lazy);
        const datasets = await Promise.all(eager.map(loadPartitionKb));
        kbCache = datasets.flat().map((c, i) => {
            if (!c.id) c.id = `auto_${i}`;
            return c;
        });
    }

    // Lazy-load reactors on first nuclear query
    if (includeReactors && !reactorsCache) {
        const reactorPartition = PARTITIONS.find(p => p.name === 'reactors');
        if (reactorPartition) {
            reactorsCache = await loadPartitionKb(reactorPartition);
            reactorsCache = reactorsCache.map((c, i) => {
                if (!c.id) c.id = `reactor_auto_${i}`;
                return c;
            });
        }
    }

    return includeReactors && reactorsCache
        ? [...kbCache, ...reactorsCache]
        : kbCache;
}

// ── Vector loader (supplier + toolkit only) ───────────────────────────────────

async function loadVectors() {
    if (vectorIndex) return vectorIndex;
    vectorIndex = new Map();

    const vectorPartitions = PARTITIONS.filter(p => p.vectors);
    for (const partition of vectorPartitions) {
        try {
            const r = await fetch(partition.vectors, { headers: authHeaders() });
            if (!r.ok) continue;
            const data = await r.json();
            let loaded = 0;
            for (const entry of (data.vectors || [])) {
                vectorIndex.set(entry.id, new Float32Array(entry.vector));
                loaded++;
            }
            console.log(`Frankie: loaded ${loaded.toLocaleString()} vectors from ${partition.name} (${data.model})`);
        } catch (e) {
            console.warn(`Frankie: failed to load ${partition.name} vectors —`, e.message);
        }
    }

    return vectorIndex.size > 0 ? vectorIndex : null;
}

// ── Embedding query via OpenAI ────────────────────────────────────────────────

const EMBED_TIMEOUT_MS = 10000;

async function embedQuery(query) {
    if (localStorage.getItem('frankieEmbedEnabled') === 'false') return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

    try {
        const response = await fetch(`${WORKER_URL}/embed/v1/embeddings`, {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
                model: 'text-embedding-3-small',
                input: query.slice(0, 8000),
                encoding_format: 'float'
                // No dimensions override — stored vectors are full 1536 dims
            })
        });

        if (!response.ok) {
            console.warn(`Frankie: embedQuery HTTP ${response.status} — falling back to keyword`);
            return null;
        }

        const data = await response.json();
        if (!data?.data?.[0]?.embedding) return null;

        window.TM?.log({
            api: 'openai-embed', model: 'text-embedding-3-small',
            prompt_tokens: data.usage?.prompt_tokens || 0,
            source: 'frankie', note: 'embed'
        });
        return new Float32Array(data.data[0].embedding);

    } catch (err) {
        if (err.name !== 'AbortError') console.warn('Frankie: embedQuery failed —', err.message);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosine(a, b) {
    const len = Math.min(a.length, b.length);
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < len; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

// ── Score normalisation ───────────────────────────────────────────────────────

export function normaliseScore(raw) {
    return typeof raw === 'number' ? Math.max(0, Math.min(raw / 10, 1)) : 0;
}

// ── Keyword scoring ───────────────────────────────────────────────────────────

// Common English stopwords, filtered out of query tokens before keyword scoring.
// Root-caused 2026-09-15: keywordScore() counted every token occurrence with no
// stopword filtering, so a compound question like "What are the granting criteria
// and what does SQEP stand for?" let "what/are/the/and/does/for" (which appear in
// almost every chunk, and far more often in longer chunks) dominate the score —
// a real live example scored 30 "matches" on a chunk that contained the word
// "granting" zero times, 25 of those 30 coming from five stopwords alone. That
// buried a short, precise, exact-phrase-match chunk ("Complete F4N Granting
// Criteria – All Four Requirements") outside the top 50 results entirely, so the
// live chat never saw it and had to fall back to hedging. Stopwords are stripped
// from the query's tokens only — chunk text itself is untouched — so scoring is
// driven by the words that actually carry the query's meaning.
const STOPWORDS = new Set([
    'a','an','and','are','as','at','be','been','being','by','can','could','did',
    'do','does','doing','for','from','had','has','have','having','he','her','hers',
    'him','his','how','i','if','in','into','is','it','its','me','my','of','on',
    'or','our','she','should','so','than','that','the','their','them','then',
    'there','these','they','this','those','to','was','we','were','what','when',
    'where','which','who','why','will','with','would','you','your'
]);

function tokenize(text) {
    const tokens = (text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    const filtered = tokens.filter(t => !STOPWORDS.has(t));
    // Fallback for a query that's entirely stopwords (rare) — better to score on
    // something than return zero results.
    return filtered.length ? filtered : tokens;
}

function keywordScore(tokens, chunk) {
    const searchable = (
        (chunk.text || '') + ' ' +
        (chunk.section || '') + ' ' +
        (chunk.source_file || '') + ' ' +
        (chunk.category || '') + ' ' +
        (chunk.reactor_type || '') + ' ' +
        (chunk.regulatory_body || '')
    ).toLowerCase();
    return tokens.reduce((score, token) => {
        const matches = searchable.match(new RegExp(`\\b${token}\\b`, 'g'));
        return score + (matches ? matches.length : 0);
    }, 0);
}

// ── Tier access rules ─────────────────────────────────────────────────────────

const TIER_RULES = {
    free:   { excludeReferenceOnly: true,  allowedAudiences: new Set(['company', 'both', '']) },
    member: { excludeReferenceOnly: false, allowedAudiences: null }
};

function getActiveTier() {
    return localStorage.getItem('frankieTier') || 'free';
}

function chunkAllowedForTier(chunk, tier) {
    const rules = TIER_RULES[tier] || TIER_RULES.free;
    if (rules.excludeReferenceOnly && chunk.reference_only) return false;
    if (rules.allowedAudiences && !rules.allowedAudiences.has(chunk.audience || '')) return false;
    return true;
}

export function getGatedCount(results) {
    return results.filter(r => !chunkAllowedForTier(r, 'free')).length;
}

export function clearKbCache() {
    kbCache       = null;
    reactorsCache = null;
    vectorIndex   = null;
    graphCache    = null;
}

export async function getKbStats() {
    const chunks = await loadKnowledgeBase(false);
    const reactors = reactorsCache || [];
    const allChunks = [...chunks, ...reactors];
    const sourceFiles = new Set(allChunks.map(c => c.source || c.source_file).filter(Boolean));
    const legacyCount = allChunks.filter(c =>
        c.programme_version && c.programme_version.startsWith('legacy')
    ).length;
    return {
        totalChunks: allChunks.length,
        sourceFiles:  sourceFiles.size,
        legacyCount,
        reactorsLoaded: reactorsCache !== null,
    };
}

// ── Main search export ────────────────────────────────────────────────────────

export async function searchKnowledgeBase(query, maxSources = 5) {
    // Reactors partition retired from default retrieval for the F4N-member soft launch —
    // see "Frankie, Recalibrated" proposal, §02. Re-enabled 2026-09-10 as an explicit,
    // SCC-controlled opt-in ("Nuclear Engineering Mode", scc.html → Website Features):
    // isNuclearQuery()/NUCLEAR_SIGNALS only ever run at all when SCC has switched the
    // site-wide flag on, and even then only pull in the 61k-chunk reactors KB for
    // queries that actually look nuclear-engineering-flavoured — not for every message.
    const nuclear = (await isNuclearModeEnabled()) && isNuclearQuery(query);

    // Load in parallel: KB chunks, vectors, graph
    const [chunks, vectors, graph] = await Promise.all([
        loadKnowledgeBase(nuclear),
        loadVectors(),
        loadGraph(),
    ]);

    const tier   = getActiveTier();
    const tokens = tokenize(query);
    const phrases = extractQueryPhrases(query);

    // ── Graph entity boost ────────────────────────────────────────────────────
    const boostedIds = new Set();
    if (graph) {
        const entities = extractQueryEntities(query);
        for (const entity of entities) {
            const ids = graph.entity_index[entity] || [];
            ids.slice(0, 300).forEach(id => boostedIds.add(id));
        }
        if (boostedIds.size > 0) {
            console.log(`Frankie: graph boosted ${boostedIds.size} chunks via [${extractQueryEntities(query).slice(0,5).join(', ')}]`);
        }
    }

    // Filter by tier
    const allowedChunks = chunks.filter(c => chunkAllowedForTier(c, tier));

    // Detect gated hits (for upsell prompt)
    const allScored = chunks.map(chunk => ({
        ...chunk,
        score: keywordScore(tokens, chunk)
    }));

    // Get query embedding if vectors are available
    let queryVec = null;
    if (vectors && query.trim()) {
        queryVec = await embedQuery(query);
    }

    // Score all allowed chunks.
    // Two passes: first compute each chunk's pre-boost base score, then apply
    // HANDBOOK_BOOST only when it's not what decides the outcome. Root-caused
    // 2026-09-14: a flat, unconditional multiplier let broad/generic handbook
    // chapters (e.g. a general "Leading Change" chapter) outrank a specific,
    // correct portal_guide match (e.g. the actual CSIP/action-plan how-to)
    // purely because of the ×1.4, even though the portal_guide chunk was the
    // stronger raw content match before any boost. The boost must only ever
    // break a close/tied race in handbook's favour — never manufacture a win
    // over a match that was already ahead on its own merits.
    const preScored = allowedChunks.map(chunk => {
        const kw = keywordScore(tokens, chunk);
        const graphBoost = boostedIds.has(chunk.id) ? GRAPH_BOOST : 0;
        const pBoost = phraseBoost(phrases, chunk);

        let baseScore;
        if (queryVec && vectors) {
            const chunkVec = vectors.get(chunk.id || '');
            if (chunkVec) {
                const kwNorm = Math.min(kw / 20, 1);
                const sim    = cosine(queryVec, chunkVec);
                baseScore    = (KEYWORD_WEIGHT * kwNorm + VECTOR_WEIGHT * sim) * 10;
            } else {
                // No vector — keyword only, slight penalty so hybrid results rank higher
                baseScore = Math.min(kw / 20, 1) * 5;
            }
        } else {
            baseScore = Math.min(kw / 20, 1) * 10;
        }

        return { chunk, kw, graphBoost, pBoost, baseScore };
    });

    // The strongest pre-boost match from any partition other than handbook
    // (report-evidence chunks excluded too — they're already penalised, not
    // a fair bar to clear). HANDBOOK_BOOST can only apply to a handbook chunk
    // that's already at or above this bar on its own.
    const strongestOtherRaw = preScored.reduce((max, p) => {
        if (isHandbookChunk(p.chunk) || isAnonymisedReportChunk(p.chunk)) return max;
        const raw = p.baseScore + p.graphBoost + p.pBoost;
        return raw > max ? raw : max;
    }, 0);

    const scored = preScored.map(({ chunk, kw, graphBoost, pBoost, baseScore }) => {
        let finalScore = baseScore + graphBoost + pBoost;
        const isReportEvidence = isAnonymisedReportChunk(chunk);
        const isHandbook = isHandbookChunk(chunk);
        if (isReportEvidence) finalScore *= REPORT_SOURCE_PENALTY;
        if (isHandbook && finalScore >= strongestOtherRaw) finalScore *= HANDBOOK_BOOST;
        return { ...chunk, score: finalScore, _kw: kw, _graphBoosted: graphBoost > 0, _reportEvidence: isReportEvidence, _handbook: isHandbook };
    });

    let results = scored
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSources);

    // ── Compound-question coverage ────────────────────────────────────────────
    // For a query that splits into 2+ distinct asks (see splitQueryClauses above),
    // guarantee each clause's own best-scoring chunk(s) a slot — appended on top
    // of, never instead of, the normal combined-score top-maxSources ranking, so
    // this can only add coverage, never bump a legitimately top-ranked result.
    const clauses = splitQueryClauses(query);
    if (clauses.length > 1) {
        const CLAUSE_TOP_N = 2;
        const presentIds = new Set(results.map(r => r.id));
        for (const clause of clauses) {
            const cTokens  = tokenize(clause);
            const cPhrases = extractQueryPhrases(clause);
            const clauseTop = scored
                .map(c => ({ c, s: Math.min(keywordScore(cTokens, c) / 20, 1) * 10 + phraseBoost(cPhrases, c) }))
                .filter(x => x.s > 0)
                .sort((a, b) => b.s - a.s)
                .slice(0, CLAUSE_TOP_N);
            for (const { c } of clauseTop) {
                if (!presentIds.has(c.id)) {
                    presentIds.add(c.id);
                    results.push(c);
                }
            }
        }
    }

    // ── Debug trace ───────────────────────────────────────────────────────────
    const mode = queryVec ? 'hybrid' : (vectors ? 'keyword+graph' : 'keyword');
    console.group(`🧠 Frankie retrieval [${mode}${nuclear ? '+nuclear' : ''}] — "${query.slice(0, 60)}"`);
    results.forEach((r, i) => {
        const src      = r.source_file || r.source || '?';
        const cat      = r.category || r.content_type || '?';
        const reactor  = r.reactor_type ? ` | ${r.reactor_type}` : '';
        const boosted  = r._graphBoosted ? ' ⚡graph' : '';
        console.log(`  #${i+1} score=${r.score.toFixed(2)} kw=${r._kw}${boosted} | ${src}${reactor} | ${cat} | "${(r.text||'').slice(0,80).replace(/\n/g,' ')}"`);
    });
    console.groupEnd();
    // ─────────────────────────────────────────────────────────────────────────

    const gatedHits = allScored
        .filter(c => !chunkAllowedForTier(c, tier) && c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    return {
        query,
        tier,
        mode:        queryVec ? 'hybrid' : (vectors ? 'vector-ready' : 'keyword'),
        nuclear,
        graphBoosted: boostedIds.size,
        confidence:   results.length ? normaliseScore(results[0].score) : 0,
        sourcesUsed:  results.length,
        gatedHits:    gatedHits.length,
        results
    };
}
