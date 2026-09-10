# Task: surface the retired reactors KB through NucColpedia as search results, not raw docs

## Background

Frankie (NucCol's F4N assistant, `frankie/index.html` in the `2026_Website_Update v2` repo, live at `https://www.nuccol.co.uk/frankie/`) has a knowledge base partition called **"reactors"** that is fully built, fully hosted, and never loads for anyone.

In `frankie/js/retrieval.js`, `searchKnowledgeBase()`:

```js
// Reactors partition retired from default retrieval for the F4N-member soft launch —
// see "Frankie, Recalibrated" proposal, §02. isNuclearQuery()/NUCLEAR_SIGNALS kept
// in place (unused) in case a separate, explicitly-chosen "nuclear engineering" mode
// is built later; for now this always evaluates false so the 61k-chunk reactors KB
// never loads by default.
const nuclear = false; // was: isNuclearQuery(query)
```

The actual data source (`frankie/js/retrieval.js`, partition config near the top):

```js
{ kb: `${WORKER_URL}/kb/frankie_reactors_kb.json`, vectors: null, /* 2.1GB — graph + keyword */ lazy: true, name: 'reactors' }
```

That's **61,000+ chunks** of real DCD/PCSR/Tier-1 source material — the same reactor design documents (AP1000, ABWR, APR1400, etc.) that back the Plant Explorer's component data, just at the document/prose level instead of the structured BOM level. It's a 2.1GB file, lazy-loaded (so it costs nothing until requested), and it currently has no way to be requested at all — `nuclear` is hardcoded `false`, so `loadKnowledgeBase(nuclear)` never passes `true`, so `reactorsCache` never populates, so the 2.1GB of real content just sits on Blob storage doing nothing.

It was retired deliberately for the F4N-member soft launch (see "Frankie, Recalibrated" proposal §02 if you can find it — may be in `Files of Frankenstein/frankie taxonomy/` or similar, not confirmed) — the working theory is it was too heavy/off-topic for the default F4N-compliance chat experience, not that the data itself is bad or wrong.

## The idea

Reuse this KB, but not by dumping it back into default chat retrieval. Instead: give it a **NucColpedia section** dedicated to it, where the interaction model is *search → snippet results*, not *open the actual document*.

NucColpedia today (`frankie/js/nuccolpedia-drawer.js`, ~267 lines) is a curated **link library** — 924 entries with metadata (category/country/doctype/topics), backed by a static `data/nuccolpedia_data.json` fetched same-origin. It's a directory you filter and click through to an external link. That's a different interaction model from what's wanted here: the reactors KB isn't links to external docs, it's the actual chunked, searchable text of the DCD/PCSR documents themselves. The right model is closer to Frankie's main chat search — type a query, get back scored, sourced snippet/passage results — but surfaced as a NucColpedia section rather than routed through the chat pipeline.

## What to actually figure out (this is not fully scoped — that's the job)

1. **Confirm the reactors KB is actually still good.** It hasn't been touched since it was retired — verify `frankie_reactors_kb.json` still loads, check its structure (chunk shape, what metadata each chunk carries — likely `source`, `section`, `chapter`, `text`, maybe `system_code` given how `retrieval.js`'s `resolve_system()`/section-matching logic elsewhere in this project expects DCD section numbers), and sanity-check a few real queries against it before building anything on top.
2. **Decide the surface**: a new tab/section inside the existing NucColpedia drawer (`nuccolpedia-drawer.js`), or a new sibling drawer that reuses NucColpedia's shell/styling but its own search backend. Given the interaction model is genuinely different (search-and-snippet vs. filter-a-directory), a new section within the same drawer chrome is probably right, but confirm before building.
3. **Design the search itself**: reuse the existing `searchKnowledgeBase()` machinery (tokenize, graph entity boost, tiering) against just the reactors partition, or something simpler/lighter given this is a 61k-chunk corpus that's never been tuned for this use case. Watch out for the same category of bug found and fixed elsewhere in this session — multi-word queries need per-word/OR matching, not literal-phrase substring matching, or you'll silently get zero results on anything but single-word searches.
4. **Design the result card**: snippet + source doc + section/page reference, probably with a way to see more context around the snippet without loading the "actual doc" (per Rene's framing — results, not documents). Look at how the main Frankie chat's "Sources" rail already renders KB matches (`frankie/js/ui.js`, `updateRail()`) for a pattern to reuse or adapt.
5. **Cost/perf**: 2.1GB lazy-loaded is fine when nobody triggers it; confirm what happens the first time someone does — load time, whether it needs pagination/chunked loading, whether the Worker endpoint (`${WORKER_URL}/kb/frankie_reactors_kb.json`) has any rate-limiting or auth gate to be aware of.

## Constraints (standing, carry into whatever you build)

- **Propose explicitly and get a yes before modifying shared, production, or auth-gated infrastructure** — the Cloudflare Worker, Azure Blob storage. Local file edits and site-repo edits are fine to do proactively; local commits are fine; **git push to the live website repo needs explicit sign-off** (Rene has been doing the actual `git push` himself after changes are committed locally).
- Don't touch the main chat's default retrieval path (`isNuclearQuery`/`nuclear` flag) without asking first — it was deliberately turned off for a reason (the F4N-member soft launch), and re-enabling it by accident would change default chat behaviour for everyone, not just add a new NucColpedia section.
- This project uses a device-bridge workflow: work happens directly on Rene's connected folders via `mcp__remote-devices__device_bash` where possible, or via `device_stage_files`/`device_commit_files` for edits that need the cloud workspace's tools (Node/Python, syntax-checking). Site repo is at `C:\Users\Rene Dorset\Downloads\2026_Website_Update v2` (connected folder), Reactors data at `C:\Users\Rene Dorset\Desktop\Feed_Frankie`.
- Live site is `https://www.nuccol.co.uk/frankie/index.html` — note the `www`, the bare domain is a separate WordPress hub site.

## Where to look first

- `frankie/js/retrieval.js` — the retired `reactors` partition config, `loadKnowledgeBase()`, `isNuclearQuery()`/`NUCLEAR_SIGNALS` (dead code, kept for this exact purpose).
- `frankie/js/nuccolpedia-drawer.js` — the existing NucColpedia shell/drawer to extend or sit alongside.
- `frankie/js/ui.js` — `updateRail()` for the existing "Sources" card pattern (snippet + source + match score), a likely template for the new result cards.
- `frankie/js/config.js` — `WORKER_URL` and other partition/config wiring.
- This project's docs (`claude/reactor-bom-dse-classification-handover.md`, `claude/generic-bolster-frankie-provenance.md`, `claude/frankie-session-2026-09-09-handover.md`) for background on the reactor data pipeline generally, though none of them touch this specific KB partition — this is genuinely new territory for this project's docs.
