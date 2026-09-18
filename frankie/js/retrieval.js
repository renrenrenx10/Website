
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
// Root-caused 2026-09-15/16: even after the stopword fix and PHRASE_BOOST, a
// single flat top-maxSources ranking lets whichever sub-question scores
// higher swallow every result slot, starving the other sub-question's
// content even when a good chunk exists for it — the real SQEP scoring-
// rubric chunk ranked #10 on this exact live query (kw=9, a solid match) but
// never made the default top-5 because five "granting criteria" chunks
// outscored it. This only detects "X and <wh-word/aux>...", so an ordinary
// single-topic query with an incidental "and" in it ("stainless steel and
// inconel") is left untouched.
//
// Exported for preprocessing.js: the actual per-clause coverage guarantee
// lives in app.js's handleQuery() merge step, which is the only place that
// sees every parallel searchKnowledgeBase() call and builds the final
// maxSources-capped result list — earlier attempts to guarantee coverage
// here by pushing extra results past `maxSources` were silently undone by
// three separate downstream `.slice(0, 5)` calls (claude.js's prompt
// context, evidence.js's evidence panel, ui.js's source rail) that each cap
// independently and don't know about the guarantee. Splitting the query
// into clauses stays a single, shared implementation here; preprocessing.js
// uses it to build real per-clause search terms, and app.js reserves each
// term its own slot within the maxSources cap instead of exceeding it.
export const CLAUSE_SPLIT_RE = /\s+and\s+(?=(?:what|how|why|when|where|which|who|does|do|did|is|are|can|could|should|will|would)\b)/i;

export function splitQueryClauses(query) {
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

// Score boost for a chunk that is both (a) a genuine scoring rubric
// (hasScoringRubric() above) and (b) about the same F4N pillar/topic the
// query names. Root-caused 2026-09-16 live: real hybrid (60% vector / 40%
// keyword) scoring ranks a scoring-rubric chunk very low against a plain-
// language question about its own topic — e.g. "what does SQEP stand for?"
// ranked the actual SQEP scoring-rubric chunk (0/2/7/10 "Option Score"
// bands) #46 out of 500 candidates, even run as its own isolated clause
// search, because semantically a rubric/question-table reads as an
// assessment artefact, not a definition. But F4N guidance always treats an
// entity's score criteria as part of "knowing" that entity — see claude.js's
// SCC-mode prompt: "Reference the relevant score criteria (0/2/7/10) where
// applicable" — so when the query names a pillar via F4N_ALIASES and a
// chunk is both that pillar's content and its scoring rubric, it earns a
// boost the same way GRAPH_BOOST lifts an explicitly pinned chunk. Additive
// only, and gated behind hasScoringRubric() so it can't fire on an ordinary
// chunk that merely mentions a pillar's alias in passing.
const RUBRIC_ENTITY_BOOST = 6.0;
function rubricEntityBoost(query, chunk) {
    if (!hasScoringRubric(chunk)) return 0;
    const ql = query.toLowerCase();
    const searchable = ((chunk.text || '') + ' ' + (chunk.section || '')).toLowerCase();
    // Require the query and the chunk to share the SAME specific alias term,
    // not merely the same pillar bucket — checked live 2026-09-16: matching
    // on "any alias for the shared pillar" was too loose. A query naming
    // "sqep" matched every People Excellence rubric chunk that happened to
    // contain the pillar's OTHER aliases too (e.g. "people excellence" or
    // "competency framework" in an unrelated employee-development question's
    // rubric), which pushed three different rubric chunks into the top 5 and
    // displaced the plain "SQEP stands for..." definition chunk entirely.
    // Requiring the literal same term on both sides keeps this scoped to the
    // chunk that's actually about the thing the query named.
    for (const aliases of Object.values(F4N_ALIASES)) {
        for (const alias of aliases) {
            if (ql.includes(alias) && searchable.includes(alias)) return RUBRIC_ENTITY_BOOST;
        }
    }
    return 0;
}

// Score boost for the chunk that actually spells out the "Triple 85"
// granting-criteria thresholds (85%+ overall Business Excellence score,
// 85%+ QHSE score, 85%+ of action plan completed with evidence). Root-
// caused 2026-09-15 live: Roy asked "what are the granting criteria?" and
// Frankie hedged — "the sources reference these as a group but don't spell
// out the individual thresholds" — even though the exact numeric thresholds
// exist verbatim in the KB (frankie7_supplier_kb.json, "Pre-Conditions That
// Must Be Met Before Initiating Pre-Granting"). Direct testing confirmed
// that chunk ranked #17 of 500 for the query: its own text never uses the
// word "criteria" (it's phrased as pre-conditions/a checklist), so keyword
// score misses it, and vector similarity doesn't favour a bare bullet list
// over the many chunks that use "criteria" explicitly while only gesturing
// at the numbers. Same shape of gap as RUBRIC_ENTITY_BOOST above — a chunk
// with the real, specific answer loses to chunks that merely talk about the
// topic — so it gets the same fix: detect the chunk by its distinctive
// "NN%+" threshold-list signature (>=2 such thresholds is not something
// ordinary prose does) and boost it when the query is actually asking about
// granting criteria. Additive only, gated tightly so it can't fire on an
// unrelated chunk that happens to mention one percentage in passing.
const GRANTING_CRITERIA_BOOST = 6.0;
const GRANTING_THRESHOLD_PATTERN = /\d{1,3}%\+/g;
function hasGrantingThresholds(chunk) {
    const text = chunk.text || '';
    const matches = text.match(GRANTING_THRESHOLD_PATTERN) || [];
    return matches.length >= 2;
}
function grantingCriteriaBoost(query, chunk) {
    if (!hasGrantingThresholds(chunk)) return 0;
    const ql = query.toLowerCase();
    const asksGrantingCriteria = /\bgrant(ing)?\b/.test(ql) && /\bcriteri/.test(ql);
    const asksTriple85 = /triple\s*85/.test(ql);
    return (asksGrantingCriteria || asksTriple85) ? GRANTING_CRITERIA_BOOST : 0;
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

// Regs partition note: this KB partition used to be filtered client-side down to
// UK-relevant categories (onr_sap, onr_tag, gda_guidance, cyber_security) via a
// REGS_CATEGORY_ALLOWLIST here. As of the regs corpus rebuild (2026-09-08 build,
// deployed to the live blob shortly after), the blob itself IS the narrowed set
// (kb_version: frankie_regs_v2_narrowed_plus_cyber) — so the client-side filter had
// become a no-op and was removed (blueprint v20 §9 #12/#13).

async function loadPartitionKb(partition) {
    try {
        const r = await fetch(partition.kb, { headers: authHeaders() });
        if (!r.ok) return [];
        const data = await r.json();
        let chunks = Array.isArray(data) ? data : (data.chunks || []);
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

// ── Numbered-series expansion (stages/modules/steps) ───────────────────────────
// Root-caused 2026-09-18: a single-topic question whose real answer is spread
// across many small, individually-numbered chunks (e.g. "What are the stages
// of the F4N programme?" — one intro chunk plus 8 separate "Stage 1:".."Stage
// 8:" chunks; "What happens at my Onsite Verification?" — Module 12's dozen
// "12.1".."12.6" sub-sections) never got past the flat 5-source cap. Unlike
// the compound-question case (CLAUSE_SPLIT_RE, above) there's no "and" to
// split on — it's one topic, just one that the source document itself chose
// to break into a numbered series. Detected structurally off the chunk's own
// `section` heading rather than guessing query keywords, so it generalises to
// any current or future numbered series without a topic-specific word list.
//
// SOURCES_CEILING is the shared hard ceiling every downstream consumer
// (claude.js's prompt context, evidence.js's evidence panel, ui.js's source
// rail) now respects instead of an independent hardcoded 5 — see those
// files' own 2026-09-18 comments. Kept modest (not "unlimited") so a
// detected series still can't balloon the prompt/UI without bound.
export const SOURCES_CEILING = 10;

const NUMBERED_SECTION_RE = /^(stage|module|step|phase)\s+\d+\b|^\d+\.\d+\s/i;
const SERIES_MIN_MEMBERS = 3;       // don't expand for a stray pair of numbered headings

function seriesKey(chunk, headingMatch) {
    // Group by source document + the series' own label ("stage"/"module"/
    // etc., or the leading integer for an "N.N " sub-section heading like
    // "12.2 The Day of the OSV") so "Stage 3" and "Module 12" chunks from the
    // same manual never get merged into one inflated series.
    const label = headingMatch[1]
        ? headingMatch[1].toLowerCase()
        : headingMatch[0].split('.')[0];
    return `${chunk.source_file || chunk.source || ''}::${label}`;
}

// Extract the leading number from a section heading ("Stage 3: …" → 3,
// "12.2 The Day of the OSV" → 12.2) so series members can be sorted back
// into reading order once they're pulled together from all over the
// ranked list.
function seriesOrdinal(chunk) {
    const m = (chunk.section || '').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
}

/**
 * Given `scored` — every allowed chunk with its keyword/vector score attached,
 * *including* chunks that scored 0 or scored too low to land anywhere near
 * the top — decide the final result set for this query.
 *
 * Live-tested 2026-09-18: raising maxSources alone doesn't help when a
 * numbered-series sibling scores far outside the top of the ranked list —
 * "Stage 1:".."Stage 8:" chunks barely overlap a generic "what are the
 * stages of the F4N programme?" query on keywords (their body text is
 * stage-specific detail, not repeated "F4N"/"programme"; "stages" plural in
 * the query doesn't even keyword-match "Stage" singular in their headings),
 * so they never entered any ranked window regardless of its size — only the
 * document's own intro/overview chunk ("Module 2: The F4N Journey – All 8
 * Stages in Full") scored well. Instead of trusting the ranked list to
 * contain the siblings, use the top-ranked chunk's own *source document* as
 * the anchor and scan every chunk from that document for a numbered series,
 * regardless of each member's individual score — then splice the whole
 * series into the result set in reading order. Falls back to the plain
 * score-ranked top-`maxSources` when no series is found.
 */
function expandForNumberedSeries(scored, maxSources) {
    const sorted = scored.filter(c => c.score > 0).sort((a, b) => b.score - a.score);
    const fallback = sorted.slice(0, maxSources);
    if (!sorted.length) return fallback;

    const anchorDoc = sorted[0].source_file || sorted[0].source || '';
    if (!anchorDoc) return fallback;

    // Every chunk from the anchor document whose own heading is part of a
    // numbered series, grouped by that series' label — a document can carry
    // more than one series (e.g. "Stage 1".."Stage 8" alongside "12.1".."12.6"),
    // so pick whichever group is actually a series (≥ SERIES_MIN_MEMBERS),
    // preferring the largest.
    const groups = new Map(); // seriesKey -> chunk[]
    for (const c of scored) {
        if ((c.source_file || c.source || '') !== anchorDoc) continue;
        const m = (c.section || '').match(NUMBERED_SECTION_RE);
        if (!m) continue;
        const key = seriesKey(c, m);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
    }

    let bestSeries = null;
    for (const members of groups.values()) {
        if (members.length >= SERIES_MIN_MEMBERS && (!bestSeries || members.length > bestSeries.length)) {
            bestSeries = members;
        }
    }
    if (!bestSeries) return fallback;

    // Reading order (Stage 1, 2, 3… / 12.1, 12.2…), not score order — this
    // is a structural inclusion, not a relevance ranking.
    const numbered = [...bestSeries].sort((a, b) => seriesOrdinal(a) - seriesOrdinal(b));

    // A series member with no real keyword/vector match of its own (score 0
    // or near it) still needs a non-zero, honest-looking match score in the
    // UI — it's included because it's structurally part of what was asked
    // for, not because it scored well. Floor it below the anchor's own
    // score rather than showing a misleading "0%".
    const floor = sorted[0].score * 0.3;
    const numberedScored = numbered.map(c => c.score > 0 ? c : { ...c, score: floor, _seriesIncluded: true });

    const seriesIds = new Set(numbered.map(c => c.id));
    const combined = [...numberedScored];
    for (const c of sorted) {
        if (combined.length >= SOURCES_CEILING) break;
        if (seriesIds.has(c.id)) continue;
        combined.push(c);
    }

    return combined.slice(0, SOURCES_CEILING);
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
        const rBoost = rubricEntityBoost(query, chunk);
        const gBoost = grantingCriteriaBoost(query, chunk);

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

        return { chunk, kw, graphBoost, pBoost, rBoost, gBoost, baseScore };
    });

    // The strongest pre-boost match from any partition other than handbook
    // (report-evidence chunks excluded too — they're already penalised, not
    // a fair bar to clear). HANDBOOK_BOOST can only apply to a handbook chunk
    // that's already at or above this bar on its own.
    const strongestOtherRaw = preScored.reduce((max, p) => {
        if (isHandbookChunk(p.chunk) || isAnonymisedReportChunk(p.chunk)) return max;
        const raw = p.baseScore + p.graphBoost + p.pBoost + p.rBoost + p.gBoost;
        return raw > max ? raw : max;
    }, 0);

    const scored = preScored.map(({ chunk, kw, graphBoost, pBoost, rBoost, gBoost, baseScore }) => {
        let finalScore = baseScore + graphBoost + pBoost + rBoost + gBoost;
        const isReportEvidence = isAnonymisedReportChunk(chunk);
        const isHandbook = isHandbookChunk(chunk);
        if (isReportEvidence) finalScore *= REPORT_SOURCE_PENALTY;
        if (isHandbook && finalScore >= strongestOtherRaw) finalScore *= HANDBOOK_BOOST;
        return { ...chunk, score: finalScore, _kw: kw, _graphBoosted: graphBoost > 0, _reportEvidence: isReportEvidence, _handbook: isHandbook };
    });

    const results = expandForNumberedSeries(scored, maxSources);

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
