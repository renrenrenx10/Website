# Frankie chat/Plant Explorer UX changes — 2026-09-09

Closing summary of the frontend/UX work done this session, on top of the data work (see the companion doc `plant-explorer-and-data-2026-09-09.md`). All changes are in the `2026_Website_Update v2` repo (`github.com/renrenrenx10/Website`), pushed and live at `https://www.nuccol.co.uk/frankie/index.html`.

## Commits

| Commit | What |
|---|---|
| `c34a551` | Shortened the plant-query auto-open message; added a "Reopen Plant Explorer" link and an "Open full explorer" link |
| `17c1142` | Full explorer now opens on all 18 reactors (not just AP1000) and reuses AP1000's images for the composite/"all designs" view |
| `dd0eb99` | Fixed multi-word search in the full explorer (was doing a literal-phrase match, so "pumps smr" matched nothing) |

## What changed, and why

**Before:** asking Frankie a plant/component question (e.g. "where do the pumps sit") auto-opened the quick-search drawer with a paragraph nobody read once the drawer was already open, and there was no way to get back to that view if you navigated away or closed the drawer.

**Now:** the chat message is one line — `Opened Plant Explorer for "X"` — with a **Reopen Plant Explorer ↗** link. That link works from anywhere in the chat history, any time later in the conversation, and reads the original query off a data attribute rather than a live global, so it stays correct even if you've asked several plant questions since.

**Before:** the quick-search drawer (the one that opens automatically, flat keyword-match list) had no way to escalate into the full Plant Explorer tool (zone map, per-building drill-down, images) — you'd have to close it and separately click the sidebar nav link, which opened unfiltered on AP1000 only.

**Now:** an **"Open full explorer ↗"** link sits next to the search box in the quick-search drawer. Clicking it carries the current search term across, opens the full explorer set to "All 18 designs" (not AP1000-only), and runs the same term through the full explorer's own search — three separate bugs fixed to get there, described below.

## Three real bugs found and fixed along the way

1. **Full explorer defaulted to AP1000, ignored the search term.** `PlantExplorerDrawer.open()` took no arguments and hardcoded `reactorSelect.value = 'AP1000'` on first load. Now `open(searchTerm)` accepts an optional term: when present, it sets the reactor filter to `'ALL'` (whether this is the first open or a later one) and runs the term through the explorer's capability/commodity search.

2. **The "All 18 designs" composite view used a stale, separately-drawn image.** `PLANT_VIEWS` (the per-reactor cutaway image + building-polygon data) has no `'ALL'` entry, so it was silently falling back to `pvRestoreOriginal()` — a completely different image (`images/plant-explorer/zone-map.jpeg`) with a hand-drawn 5-zone overlay that doesn't match any current building layout. Fixed by having `pvViewKey('ALL')` resolve to `'AP1000'`, so the composite view now reuses AP1000's already-correct image and building polygons instead of a second, unmaintained image set. This only changes which image/polygons render — the underlying data (`ACTIVE_TREE`) still spans all 18 reactors.

3. **Full explorer's search only matched a literal whole-phrase substring.** `runSearch(query)` did `label.includes(query)` against the *entire* query string, so a multi-word term like "pumps smr" (carried over from the quick-search drawer) matched nothing — no label literally contains that phrase — and silently cleared back to the unfiltered view. It now splits the query on whitespace and unions the matches per word, same approach the quick-search drawer's own `searchMulti()` already used.

## Not done / explicitly out of scope

- Per-section "view in explorer" buttons inside the drawer (one button total was judged sufficient — "can be one for all... but whatever").
- Changing the hard auto-redirect for direct plant questions (still skips the KB pipeline entirely rather than giving a prose answer plus a link) — flagged as a possible future change, not requested.
- A link to the underlying plant database/workbook itself (raw file vs. hosted table view vs. full mini-UI) — discussed, not built. See the companion data doc for the options.
