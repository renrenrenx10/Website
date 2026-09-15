import { CONFIG } from './config.js';
import { splitQueryClauses } from './retrieval.js';

const INTENT_PATTERNS = {
    Procedure: ['how', 'steps', 'process', 'prepare', 'perform'],
    Comparison: ['compare', 'difference', 'versus', 'vs'],
    Risk: ['risk', 'issue', 'problem', 'concern'],
    Summary: ['summarise', 'summary', 'overview'],
    Question: []
};

// Mirrors retrieval.js's STOPWORDS — kept as its own small copy rather than an
// import since only single-word term *selection* needs it here (retrieval.js's
// own tokenize() applies the full list to actual scoring regardless).
const STOPWORDS = new Set([
    'a','an','and','are','as','at','be','been','being','by','can','could','did',
    'do','does','doing','for','from','had','has','have','having','he','her','hers',
    'him','his','how','i','if','in','into','is','it','its','me','my','of','on',
    'or','our','she','should','so','than','that','the','their','them','then',
    'there','these','they','this','those','to','was','we','were','what','when',
    'where','which','who','why','will','with','would','you','your'
]);

export async function preprocessQuery(query) {
    const intent = detectIntent(query);
    const rewrittenQueries = rewriteQuery(query);

    // Dedupe against the original query — rewriteQuery/splitQueryClauses can
    // both legitimately return the query unchanged (single-clause, or a query
    // that's mostly stopwords), and app.js only keeps the first 3 searchTerms
    // for its parallel search, so a literal duplicate of the original query
    // was silently burning 1-2 of those 3 slots on a repeat of the same call
    // (root-caused 2026-09-16 alongside the granting-criteria/SQEP retrieval
    // gap: for a compound query this left only one slot for actual diversity,
    // and it went to whichever >3-letter word happened to appear first in the
    // query — often a stopword like "what", not the term that needed its own
    // dedicated search).
    const searchTerms = [query, ...rewrittenQueries].filter(
        (value, index, array) => value && array.indexOf(value) === index
    );

    return {
        originalQuery: query,
        intent,
        rewrittenQueries,
        searchTerms
    };
}

function detectIntent(query) {
    const lower = query.toLowerCase();

    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
        if (patterns.some(pattern => lower.includes(pattern))) {
            return intent;
        }
    }

    return 'Question';
}

function rewriteQuery(query) {
    // A compound question ("X and what/how/does...Y") splits into its own
    // asks first — each clause is a far more useful, self-contained search
    // term than a single word, and this is what actually lets a compound
    // query's weaker-but-real sub-topic (e.g. "what does SQEP stand for")
    // get its own full-budget searchKnowledgeBase() call instead of being
    // drowned out inside one merged ranking. See splitQueryClauses() in
    // retrieval.js for the detection rule and its root-cause writeup.
    const clauses = splitQueryClauses(query);
    if (clauses.length > 1) {
        return [query, ...clauses];
    }

    // Otherwise fall back to picking out a few specific single words —
    // stopwords excluded so a slot isn't spent on "what"/"does"/"the" ahead
    // of an actual content word (previously: "what are the granting
    // criteria..." picked terms in raw word order, so the first three
    // longer-than-3-letter words could be "what", "granting", "criteria" —
    // "what" is not a useful independent search term).
    const terms = query.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3 && !STOPWORDS.has(word));

    return [
        query,
        ...terms.slice(0, 3),
        terms.join(' ')
    ].filter((value, index, array) => value && array.indexOf(value) === index);
}

export function compressContext(results, maxChunks = 4) {
    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, maxChunks);
}
