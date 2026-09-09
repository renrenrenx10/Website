// ── Handbook deep-link matcher ──────────────────────────────────────────────
// Matches a KB chunk's text against handbook_url_map.json's topic slugs by
// keyword overlap, and returns a members.html deep-link (?open=handbook&q=...)
// when confident. Heuristic, not exact — a chunk that doesn't score a decent
// match gets no link at all rather than a wrong one.
// See "Frankie, Recalibrated" proposal, §08 — this is the matching step that
// was still missing after members.html's deep-link handler shipped.

const MAP_FILE = 'kb/handbook_url_map.json'; // static, same-origin — no Worker needed
const MEMBERS_URL = 'https://www.nuccol.co.uk/members.html';

// Categories worth checking — F4N/portal guidance parallels the member
// handbook's content; reactor/regs/toolkit chunks don't, so never link them.
const LINKABLE_CATEGORIES = new Set(['f4n_guidance', 'portal_guide', 'workbooks']);

const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with',
    'is', 'are', 'be', 'this', 'that', 'it', 'as', 'by', 'at', 'from',
    'your', 'you', 'their', 'will', 'can', 'should', 'must', 'have',
    'person', 'description', 'select', 'statement', 'best', 'describes',
    'current', 'status',
]);

// Boilerplate phrases repeated verbatim across ~95 F4N training chunks (e.g.
// every "Why This Matters..." intro, every scoring-rubric header) that would
// otherwise dominate the keyword overlap regardless of the chunk's actual
// topic — found via a real test against the corpus, 2026-09-08. Stripped
// before tokenizing so matching runs on the chunk-specific content only.
const BOILERPLATE = [
    'why this matters for nuclear supply chain readiness',
    'score | description',
];

function stripBoilerplate(text) {
    let t = text || '';
    for (const b of BOILERPLATE) {
        t = t.replace(new RegExp(b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
    }
    return t;
}

let mapCache = null; // [{ code, words: Set<string> }]

function tokenize(text) {
    return stripBoilerplate(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !STOPWORDS.has(w));
}

async function loadHandbookMap() {
    if (mapCache) return mapCache;
    try {
        const r = await fetch(MAP_FILE);
        if (!r.ok) { mapCache = []; return mapCache; }
        const raw = await r.json();
        mapCache = Object.entries(raw).map(([slug, code]) => ({
            code,
            // Strip a trailing digit (e.g. "...manufacture2") — dedup artefact,
            // not a meaningful word — then tokenize the slug into keywords.
            words: new Set(tokenize(slug.replace(/-/g, ' ').replace(/\d+$/, ''))),
        }));
        console.log(`Frankie: handbook_url_map loaded — ${mapCache.length} topic slugs`);
    } catch (e) {
        console.warn('Frankie: handbook_url_map load failed —', e.message);
        mapCache = [];
    }
    return mapCache;
}

const MIN_OVERLAP = 2; // require at least this many shared significant words

export async function matchHandbookLink(chunk) {
    if (!chunk || !LINKABLE_CATEGORIES.has(chunk.category)) return null;
    const map = await loadHandbookMap();
    if (!map.length) return null;

    const chunkWords = new Set(tokenize((chunk.text || '').slice(0, 400)));
    if (!chunkWords.size) return null;

    let best = null, bestScore = 0;
    for (const entry of map) {
        let overlap = 0;
        for (const w of entry.words) if (chunkWords.has(w)) overlap++;
        // Score relative to the slug's own word count — a slug that's mostly
        // contained in the chunk text is a strong signal, not just a big chunk.
        const score = entry.words.size ? overlap / entry.words.size : 0;
        if (overlap >= MIN_OVERLAP && score > bestScore) {
            bestScore = score;
            best = entry;
        }
    }

    if (!best) return null;
    return `${MEMBERS_URL}?open=handbook&q=${best.code}`;
}
