# Frankie changelog

## 2026-08-04 — Drawers anchored to the sidebar edge

**All form-style drawers now pull out from the same spot: right at the edge
of the left sidebar (282px), instead of floating as a narrow box over on the
right of the screen.** Applies to the shared `.assess-panel` drawer (Evidence
Vault, Website Review's sibling `.wr-panel`, ISO 19443, Social Value,
Supplier Intel, Toolbox Talk, SOP Builder, Safety Culture, Quality Plan,
SQDCP, NCR, Strategy Builder, Business/F4N Self-Assessment, NucColpedia).
Both now use `left: 282px` + `max-width` instead of `right: 0` + fixed
`width`, and slide in with `translateX` from the left instead of the right.
Below the 1050px breakpoint (where the sidebar already collapses out of the
`.app` grid) the drawers fall back to `left: 0` so there's no dead gap.

**Deliberately excluded: Plant Explorer.** Its `.pe-drawer-panel` stays a
full-screen overlay — it needs the whole canvas for the zone map and
per-reactor cutaways, per the existing code comment in
`plant-explorer.css`.

### Files touched
- `frankie/css/styles.css` — `.assess-panel` and `.wr-panel` repositioned.

### Backup taken before editing
- `frankie/css/styles.css.backup-20260804-*-preDrawerReposition`

## 2026-08-04 — Sidebar restyle, grouped nav, NucColpedia drawer

**Sidebar restyled to match the SCC portal (`scc.html`).** Replaced the
bordered `.assess-launch-btn` grid with a flat `.sb-item`/`.sb-section` nav
list (same classes/sizing as scc.html's left menu: `.85rem` items, `.66rem`
uppercase section labels, no borders, subtle hover). New CSS block at the
end of `frankie/css/styles.css`.

**Tools grouped into categories** instead of one flat list of 13 buttons:
- Compliance & Evidence — Evidence Vault, Website Review, ISO 19443 Position,
  Social Value Finder, Supplier Intel
- Quality & Safety — Toolbox Talk, SOP Builder, Safety Culture, Quality Plan,
  SQDCP Wizard, NCR Investigation
- Reference & Strategy — Strategy Builder, Plant Explorer, **NucColpedia**
- Self Assessment — Business Excellence, Fit for Nuclear (unchanged, restyled)

**New drawer: NucColpedia.** Ported the standalone `NucColpedia.html`
library tool (924 external research links across 21 categories, 64
countries, 24 topics) into Frankie as a searchable/filterable drawer,
grouped alongside Plant Explorer under Reference & Strategy.
- `frankie/data/nuccolpedia_data.json` — new, ~1.1MB. Extracted from
  `NucColpedia.html`'s inline `DATA`/`CATEGORIES`/`COUNTRIES`/`DOCTYPES`/
  `TOPICS` arrays via a Python script (avoids edit-tool truncation risk on
  a >1MB single-line JS literal); round-trip verified at 924/21/64/24
  before use.
- `frankie/js/nuccolpedia-drawer.js` — new. Search box + category/country/
  doctype/topic filters, card results (title, link, category/type pills,
  description, keywords), capped at 200 rendered cards per query for
  performance (match count still shown in full).
- `frankie/css/nuccolpedia.css` — new. Reuses the shared
  `.assess-drawer`/`.assess-panel`/`.assess-topbar` shell so it opens/closes
  consistently with the other tools.
- `frankie/index.html` — added stylesheet/script includes, sidebar button
  (`data-tool="nuccolpedia"`, respects the existing SCC tool-visibility
  flags in localStorage same as every other tool).

### Files touched
- `frankie/index.html` — sidebar markup regrouped, new includes.
- `frankie/css/styles.css` — new `.sb-nav`/`.sb-section`/`.sb-item` block.
- `frankie/css/nuccolpedia.css` — new.
- `frankie/js/nuccolpedia-drawer.js` — new.
- `frankie/data/nuccolpedia_data.json` — new.

### Backups taken before editing
- `frankie/index.html.backup-20260804-142249-preNucColpedia`
- `frankie/css/styles.css.backup-20260804-142249-preNucColpedia`

### Verified
- `node -c` on the new JS — no syntax errors.
- Tag-balance check on `index.html` (div/script/nav/aside/button/main/section
  all open==close) and file still ends with `</html>` — no truncation.
- `nuccolpedia_data.json` round-tripped through `json.load` with the
  expected counts (924 entries / 21 categories / 64 countries / 24 topics).

## 2026-08-04 — Plant Explorer layer 2 + fixes

**Layer 2 build (the "sliced version").** Added per-reactor cutaway diagrams with
clickable building hotspots and numbered equipment callouts to the Plant Explorer
tool, ported from the standalone `NuCCoL_Plant_Explorer_v2_images.html`. Selecting
a specific reactor design now swaps the flat zone map for that reactor's cutaway
image; "All 18 designs" still shows the original zone map.
- `frankie/js/plant-explorer-drawer.js` — added `PLANT_VIEWS`, `PLANT_INFO`,
  `PV_CALLOUTS`, `PV_IMG`, `DSE_BUILDINGS`, `PV_STORY_CUSTOM`, and all `pv*`
  rendering functions.
- Images already extracted in a prior session to `frankie/images/plant-explorer/pv/*.jpeg`
  (see `manifest.json` in that folder) — now actually wired in.

**Bug: drawer defaulted to the flat zone map instead of a sliced view.**
Fixed by auto-selecting AP1000 on first open (matches the standalone tool's
original behaviour).

**Bug: numbered building badges did nothing when clicked.**
`pvApplyView()` was gating click listeners behind `pvCount(b.dse) > 0`. Removed
the gate — `pvRenderBuildingLevel()` already shows a graceful "No components
mapped to this building yet" empty state, so there was no reason to block
navigation.

**Bug (the real one): components never mapped for any specific reactor.**
Root cause, found via a temporary `PlantExplorerDrawer.debug()` console helper:
the live `kb/plant_tree_data.json` (fetched from the gated Worker, same file the
chat's `PlantDrawer` feature uses) has **0 of 4466 subcomponents with a populated
`reactors[]` field** — it's the older generic DSE taxonomy, not the reactor-mapped
v2 schema. Any specific-reactor filter (`filterTreeForReactor`, `pvFilterSet`)
silently produced an empty tree.

Fix: extracted the standalone tool's own baked-in `PLANT_TREE` (which **does**
have full reactor mapping — 8361 subcomponents, 100% with `reactors[]`/
`instances[]` across all 18 designs) to a new static asset:

  **`frankie/images/plant-explorer/plant_tree_v2.json`** (~12MB)

Plant Explorer now fetches this file directly (same-origin, no auth token
needed) instead of the gated Worker endpoint. Verified: AP1000 → Containment
Building now shows 329 real components instead of 0.

This means **Plant Explorer's data is now decoupled from the chat's `PlantDrawer`
feature**, which still uses the older generic tree via the Worker — a deliberate
trade-off until the live KB is rebuilt with the v2 schema.

**Security: `/frankie/` had no page-level login gate.**
Only KB/Worker data calls were gated — the page itself (all UI, images) was
visible to anyone who navigated there directly. Added a blocking Supabase
session check at the top of `frankie/index.html` that hides the page and
redirects to `../members.html` if there's no valid session.

**Bug: no way to close the Plant Explorer drawer.**
`.pe-drawer-close` (the ✕ button) had `z-index:20` while `#topbar` has
`z-index:200`, so the topbar fully covered it. Bumped the close button above
the topbar and gave `#topbar` extra right padding.

**Bug: logging in from the new auth-gate redirect left you on the members
portal, not back on Frankie.**
`members.html` had no way to send people back after login. Added
`redirectIfPending()` (checks a `?redirect=` query param, validates it's a
same-site absolute path) called from both the "session already exists" branch
and the `SIGNED_IN` handler. `frankie/index.html` now passes
`?redirect=/frankie/` when it bounces to login.

### Files touched
- `frankie/js/plant-explorer-drawer.js` — layer 2, click-gate fix, reactor-select
  default, v2 data source switch, `debug()` helper (safe to remove later).
- `frankie/images/plant-explorer/plant_tree_v2.json` — new, ~12MB, the real
  reactor-mapped tree.
- `frankie/index.html` — auth gate.
- `frankie/css/plant-explorer.css` — close button z-index + topbar padding.
- `members.html` — post-login redirect.

### Known follow-ups
- `PlantExplorerDrawer.debug()` in `plant-explorer-drawer.js` is a temporary
  diagnostic helper — fine to leave (read-only) but could be removed once
  confident the fix holds.
- The chat's `PlantDrawer` feature (`js/plant-drawer.js`) still uses the older
  generic `kb/plant_tree_data.json` via the Worker — no reactor-specific
  mapping there. Rebuilding that live KB endpoint with the v2 schema would let
  the two features share one source of truth again.
