# Frankie changelog

## 2026-09-11 — Self-assessment/Evidence Vault: three fixes from live feedback

Three issues Rene hit testing the persistence + cross-link work added
earlier today.

**1. Removed the redundant per-answer "feedback" text.** Selecting an
option showed a second block of near-identical text below it — e.g.
selecting "Mission, vision, and values are well-defined and communicated,
supporting alignment" then showed "The mission, vision, and values are
defined and communicated but not consistently used to guide actions..."
directly under it. Checked `assessment_data.json`: `desc` (the option
button's own text) and `feedback` (this second block) are just two
paraphrases of the same content for every option — the feedback block was
adding no new information, only restating. Removed the text; kept the
"View in handbook →" link where one exists (genuinely useful, not
redundant), moved above the evidence-link button so the reading order is
learn-more first, then act.

**2. Evidence Vault: uploaded files' delete (✕) buttons didn't work.**
Real bug, not a design choice: `renderSection()` was binding a click
handler by looking up an element id (`ev-del-{key}`) that renderQuestion()
never creates, calling a function (`handleDelete`) that isn't defined
anywhere in the file — dead code, probably left over from an earlier
version of this UI. The actual working delete path
(`handleDeleteByKey` + `.ev-file-del` buttons) was only ever bound inside
`handleUpload()`'s and `handleDeleteByKey()`'s own re-render of a single
question — never on the section's *initial* render — so a file already on
file when the drawer opened (the normal case, for anyone revisiting their
own evidence) showed a delete button that silently did nothing. Fixed with
a shared `bindQuestionFileDelete()` helper, called on initial section
render and scoped appropriately on later re-renders so it doesn't restack
a second listener onto every other question's buttons each time.

**3. No way back to the self-assessment after attaching evidence.**
Clicking "Attach evidence for this answer" opened Evidence Vault, and
`drawer-manager.js`'s single-drawer-at-a-time rule (2026-08-04) correctly
closed the assessment behind it — but closing Evidence Vault just dropped
the member at the main chat, with no path back in short of re-opening the
assessment from the sidebar (their answers do survive, per today's earlier
persistence fix, but the flow felt like a dead end). Fixed without
reintroducing overlapping drawers (deliberately not touched — that was a
real fixed bug in this codebase's history): `EvidenceVault.open()` now
accepts an optional third argument, `{returnTo, type, sectionIdx}`; when
present, explicitly closing Evidence Vault (X / backdrop / Escape only —
NOT drawer-manager.js force-closing it because some other tool got opened
instead) reopens `AssessmentDrawer` at the exact section the member came
from. A plain sidebar-menu open of Evidence Vault passes no such option, so
it opens and closes exactly as it always has.

### Files touched
- `frankie/js/assessment-drawer.js` — feedback block removed, evidence-link
  click handler passes a return target, `open()` accepts an optional
  starting section index.
- `frankie/js/evidence-vault-drawer.js` — dead delete-binding code replaced,
  `open()`/`close()` handle the return target.

### Verified
- `node --check` on both files — no syntax errors.
- Confirmed `desc`/`feedback` are near-duplicate text for every option in
  `frankie/kb/assessment_data.json`'s first section, before removing the
  feedback block.
- Grepped for any remaining reference to the removed `handleDelete`/
  `ev-del-` dead code — none left.
- Not live-tested end to end (no test member credentials available in this
  session, same limitation as the sign-out fix above).

## 2026-09-11 — Sign out

**Bug: no way to log out of Frankie.** The auth-gate added 2026-08-04
(`frankie/index.html`) only ever checked *for* a Supabase session and
redirected to login if one was missing — nothing anywhere called
`auth.signOut()`. So the page just kept re-authenticating on every visit for
as long as the browser held a valid session, with no escape hatch. Reported
live by Rene.

Fix: a "Sign out" button in the sidebar's Access box (the account-status
area, right below the brand mark) that signs out of Supabase, clears the
`frankieUserId`/`frankieUserToken`/`frankieCompanyName` identity keys other
Frankie tools read (members.html's own `SIGNED_OUT` listener already does
this, but that listener only runs on members.html itself, not here — it
never fires from inside Frankie), and sends the user back to
`../members.html`.

### Files touched
- `frankie/index.html` — Access box markup, new `initSignOut()` script block.
- `frankie/css/styles.css` — `.access-signout-btn`.

### Verified
- Tag-balance check (div/script/nav/aside/button/main/section, all
  open==close) and `</html>` present — no truncation.
- Not live-tested end to end (no test member credentials available in this
  session) — worth a real click-through after this deploys to confirm the
  redirect and that a subsequent visit actually asks for login again.

## 2026-09-11 — Self-assessment answers persist, and link to Evidence Vault

Closes the gap flagged in `frankie_blueprint_v14.docx` §10: `assessment-drawer.js`
kept every answer in memory only, so closing the drawer lost all progress and
there was no way to compare a self-declared score against the AI's read of
the evidence for the same question.

Decided with Rene: Frankie's self-assessment is a **practice** exercise —
the real submission happens in the separate F4N portal, which has no API to
push scores to. So the fix isn't "sync to the portal," it's "make the
practice run persist, and connect it to evidence gathering," so a company's
practice answers, evidence uploads, and AI feedback all build toward the
same OSV prep rather than living in three disconnected places.

**Answers now persist per question.** New table `nr_self_assessment_answers`
(`frankie/sql/nr_self_assessment_answers.sql`) keyed by
`(company_id, assessment_type, section, q)` — the same `(section, q)`
convention `nr_evidence_analysis` already uses, with `q` 1-based to match.
Reopening the drawer (or coming back in a later session) now restores prior
answers instead of starting over. Unlike `nr_evidence_analysis`, SCC gets
read-only access here — no override policy — since the real score gets
verified at the actual assessment, not adjusted by SCC inside Frankie.
Writes are fire-and-forget (never block the click, never throw back to the
UI) — a failed save just leaves that answer session-only, same
graceful-degrade shape Evidence Vault's own writes already use.

**Cross-link into Evidence Vault.** Each question in the self-assessment (BE
only, for now — Evidence Vault has no f4n data yet) gets a
"📎 Attach evidence for this answer →" link. `EvidenceVault.open()` now takes
optional `(secName, qNum)` args, jumps straight to that section, and scrolls
to + briefly highlights that question's card — no new plumbing needed for
the link itself, since the two tools' question keys already lined up 1:1.

**Why this matters for the Pre-OSV Pack (Feature C):** once both a
self-declared score and an evidence AI score exist under the same key, the
Pre-OSV Pack can show the comparison it was missing, instead of just the AI
read on its own. Not built this session — the schema now supports it,
building the comparison view is the next piece.

### Files touched
- `frankie/sql/nr_self_assessment_answers.sql` — new. Needs to be run in the
  Supabase SQL editor before this reaches production (same "documented, not
  yet confirmed run" status as the `member_events` table added 2026-09-10 —
  worth checking both at once).
- `frankie/js/assessment-drawer.js` — Supabase persistence
  (`getCompanyId`/`loadAnswers`/`saveAnswer`), evidence cross-link button +
  handler.
- `frankie/js/evidence-vault-drawer.js` — `open()` accepts an optional jump
  target, `scrollToJump()` helper.
- `frankie/css/styles.css` — `.assess-evidence-link`.
- `frankie/css/evidence-vault.css` — `.ev-question--jump-highlight`.

### Not done this session
- No UI change to the results screen yet — it still shows section-level %
  only, not a per-question list. Rene's own framing of the deliverable
  ("a list of scores the user enters onto the portal") argues for a
  transcription-friendly per-question list there — flagged as the natural
  next step, not built now to keep this change reviewable on its own.
- Self-declared vs AI-score comparison view (the Pre-OSV Pack payoff above)
  — data model is ready, view isn't built.
- F4N evidence linking — no `f4n_evidence_map.json` equivalent exists, so
  the cross-link is BE-only until one does.

### Verified
- `node --check` on both edited JS files — no syntax errors.
- Supabase URL/anon key in `assessment-drawer.js` byte-compared against
  `evidence-vault-drawer.js`'s copy — same project.
- Not live-tested against Supabase (no running session available in this
  pass) — the new table needs to actually exist first; see above.

## 2026-08-05 — Hero landing page + Frankie Chat menu entry

Frankie no longer drops straight into the chat UI on load. The main panel
now opens on a hero screen — the Frankiebot mark, an intro to what Frankie
does, the live brain-check status pill (mirrors the topbar status live, with
a nudge to wait for "All systems go" before asking a question), a feature
checklist, and an "Open Frankie Chat →" button. The chat/composer/rail stay
in the DOM (`hidden` until opened) so nothing about chat behaviour changed —
only what's shown first.

**Menu changes:** the "FAQs" section is now labelled "Frankie Chat" and
holds two links — a new "Chat with Frankie" (switches from hero to chat) and
"Common Questions" (opens the FAQ drawer, as before). Both are now plain
`.sb-item` links matching the rest of the sidebar — "Common Questions" was
previously styled as a standalone `.assess-launch-btn`.

### Files touched
- `frankie/css/hero-landing.css` — new.
- `frankie/js/hero-landing.js` — new. Exposes `window.FrankieHero.showChat()` /
  `.showHero()`; mirrors `#statusBtnDot`/`#statusBtnLabel` into the hero's
  status pill via `MutationObserver`.
- `frankie/index.html` — hero markup added to `.main` (before `#messages`);
  `#messages`/`#composer` now start `hidden`; new CSS/JS includes; sidebar
  FAQ block replaced with the "Frankie Chat" `sb-nav` section. Hero markup
  reuses the same `.drawer-splash`/`.ds-*` template every tool intro uses
  (see "Intro splash for every drawer" below), not a bespoke layout, so it's
  visually consistent with the rest of Frankie. Only addition is the status
  pill and a gradient bot-mark tile (`.hero-art`) in place of the white
  emoji card, since Frankie's own mark isn't an emoji.

## 2026-08-05 — Intro splash for every drawer

Every tool drawer now opens on a brand intro screen the first time it's
used — what the tool is, what it covers, a bespoke illustration — instead
of dropping straight into a form. Shown once per tool (remembered via
localStorage), then goes straight to the tool on later opens; a small ℹ️
button in the topbar brings it back on demand.

**New shared kit** (`frankie/css/drawer-splash.css` + `frankie/js/drawer-splash.js`):
one `DrawerSplashKit.attach(el, config)` call per drawer, added right after
`document.body.appendChild(el)` in each drawer's `inject()`. Sized to the
drawer panel, not the full viewport — the sidebar stays visible behind it
(this was a deliberate distinction from Plant Explorer's genuinely
full-screen canvas). Navy background matching the brand, inset with a 2px
light border, bespoke SVG illustration per tool in a white card, and the
same icon each tool already uses in the sidebar (no new icon set to design —
reused what's already there).

Applied to all 15 tool entry points: Evidence Vault, Website Review,
ISO 19443 Position, Social Value Finder, Supplier Intel (Compliance &
Evidence); Toolbox Talk, SOP Builder, Safety Culture, Quality Plan, SQDCP
Wizard, NCR Investigation, Strategy Builder (Toolbox Builder); Plant
Explorer, NucColpedia (References); and Self Assessment (Business
Excellence + Fit for Nuclear share one drawer, one combined splash).

**Plant Explorer needed a small kit tweak.** It has no dedicated topbar
wrapper — its close button floats directly in the panel — so the kit falls
back to anchoring the info button next to it there instead, with matching
floating CSS (`.pe-drawer-panel > .ds-info-btn`).

### Files touched
- `frankie/css/drawer-splash.css` — new.
- `frankie/js/drawer-splash.js` — new.
- `frankie/index.html` — new CSS/JS includes.
- `frankie/js/evidence-vault-drawer.js`, `website-review.js`,
  `iso19443-drawer.js`, `social-value-drawer.js`, `due-diligence-drawer.js`,
  `toolbox-talk-drawer.js`, `sop-builder-drawer.js`,
  `safety-culture-drawer.js`, `cqp-drawer.js`, `sqdcp-drawer.js`,
  `ncr-drawer.js`, `strategy-drawer.js`, `plant-explorer-drawer.js`,
  `nuccolpedia-drawer.js`, `assessment-drawer.js` — one `attach()` call +
  config each.

### Backup taken before editing
- `frankie/backups_20260805-*_preSplash/` — full copy of `js/`, `css/`, and
  `index.html` before this rollout.

### Verified
- `node --check` on every file in `frankie/js/` — all clean.
- 15 `DrawerSplashKit.attach` call sites confirmed (16th match is the usage
  example in the kit's own doc comment), all with unique `key` values — no
  localStorage flag collisions.
- `index.html` tag-balance check (div/script/nav/aside/button/main/section/
  meta/link) and `</html>` present — no truncation.
- `css/drawer-splash.css` brace-balance check.

## 2026-08-04 — Full HTML audit: two CSP-blocked tools fixed

Full pass over `frankie/index.html` and its dependency tree following a
report that "the website isn't connecting." Structural integrity was clean
(all script/link references resolve, no truncation, no duplicate IDs, all
JS syntax-checked). Found two real, pre-existing connectivity bugs, both
caused by the page's CSP not covering domains those tools depend on:

**Website Review was calling things the CSP doesn't allow — fixed by
routing through the Worker instead of whitelisting.**
- `fetchWebsite()` called `https://corsproxy.io` directly — not in
  `connect-src`, so every "Review" click failed with a silent CSP violation.
- `callClaude()` called `https://api.anthropic.com` directly from the
  browser with a key read from `localStorage.frankieClaudeKey` — also not
  in `connect-src`, and inconsistent with how every other tool talks to
  Claude (through the Worker, server-side key).
- Fix: `js/website-review.js` now calls the Worker's own `/fetch?url=` and
  `/claude/v1/messages` routes (same `Authorization: Bearer
  frankieUserToken` pattern as `claude.js`, `evidence-vault-drawer.js`,
  etc.). No CSP changes needed for this one, no client-stored API key
  required anymore.

**Plant Explorer's Map view loads Leaflet from unpkg.com and tiles from
OpenStreetMap — neither was in the CSP.**
- `initMap()` in `js/plant-explorer-drawer.js` dynamically injects
  `<script>`/`<link>` tags from `unpkg.com` (blocked by `script-src`/
  `style-src`) and renders map tiles from `*.tile.openstreetmap.org`
  (blocked by `img-src`).
- Fix: added `https://unpkg.com` to `script-src` and `style-src`, and
  `https://*.tile.openstreetmap.org` to `img-src` in the CSP meta tag.

### Files touched
- `frankie/js/website-review.js` — `fetchWebsite()` and `callClaude()`
  rewritten to use the Worker.
- `frankie/index.html` — CSP `script-src`/`style-src`/`img-src` extended.

### Backups taken before editing
- `frankie/js/website-review.js.backup-20260804-*-preWorkerFetch`
- `frankie/index.html.backup-20260804-*-preCSP`

### Verified
- `node --check` on `website-review.js` — no syntax errors.
- `index.html` tag-balance check (div/script/nav/aside/button/main/section/
  meta) and `</html>` present — no truncation.
- CSP line printed and re-read back to confirm the exact string landed
  correctly.

### Not fixed (flagged, no action taken without confirmation)
- Nothing else found — the auth-gate / Supabase session flow at the top of
  `index.html` couldn't be exercised without a live browser; if the page
  goes fully blank rather than a specific tool failing, that's the next
  place to check via the browser console.

## 2026-08-04 — Access box simplified, menu regrouped

**Access section:** Frankie is members-only, so the Free/Member tier picker
(previously hidden entirely via `display:none`) is now a single static
"Member — Full access to Frankie" box — no click handler, nothing to choose.

**Menu regrouped:**
- New **References** section (Plant Explorer, NucColpedia) moved to
  right after the FAQ launcher, ahead of the tool groups. Replaces the old
  "Reference & Strategy" grouping.
- **Strategy Builder** moved out of References and into the renamed
  **Toolbox Builder** section (was "Quality & Safety" — Toolbox Talk, SOP
  Builder, Safety Culture, Quality Plan, SQDCP Wizard, NCR Investigation,
  Strategy Builder).
- Sidebar order is now: Access → FAQs → References → Compliance & Evidence
  → Toolbox Builder → Self Assessment.
- `applyToolFlags()` now also hides `#section-references` if every button
  inside it is switched off via SCC tool-visibility settings (previously
  only checked `section-supplierTools` / `section-selfAssess`).

### Files touched
- `frankie/index.html` — Access markup, sidebar regrouped, `applyToolFlags()`
  section list updated.

### Backup taken before editing
- `frankie/index.html.backup-20260804-*-preMenuRegroup`

## 2026-08-04 — Only one drawer open at a time

**Bug: opening a second tool (e.g. NucColpedia) while a first was already
open (e.g. Evidence Vault) stacked a new overlay on top instead of replacing
it** — the first drawer stayed alive behind the second, invisible, and its
backdrop/close button became unreachable, which looked "stuck" when trying
to close things. Seen live at nuccol.co.uk/frankie: both drawers' headers
visible side by side.

Fix: `frankie/js/drawer-manager.js` (new, loaded first). Watches for any
drawer root (`*-drawer` class family: `.assess-drawer`, `.wr-drawer`,
`.pe-drawer`) gaining an `--open` state class, and force-closes every other
open drawer root the same way each drawer's own `close()` does — no changes
needed in the 15 individual drawer scripts.

### Files touched
- `frankie/js/drawer-manager.js` — new.
- `frankie/index.html` — added script include, loaded right after `app.js`.

## 2026-08-04 — Drawers span full width, still slide in from the right

**All form-style drawers still pull out from the right (unchanged
animation), but once fully open they now always span the full remaining
width — from the sidebar's right edge (282px) to the screen's right edge —
instead of stopping at a narrow fixed-width box floating over on the right.**
Applies to the shared `.assess-panel` drawer (Evidence Vault, ISO 19443,
Social Value, Supplier Intel, Toolbox Talk, SOP Builder, Safety Culture,
Quality Plan, SQDCP, NCR, Strategy Builder, Business/F4N Self-Assessment,
NucColpedia) and Website Review's sibling `.wr-panel`. Both set
`left: 282px; right: 0` (no width cap) and keep `translateX(100%)` →
`translateX(0)` for the slide-in. Removed the per-tool width caps that would
otherwise have overridden this (`.ev-panel` was 780px, `.np-panel` was
1040px) — every drawer now fills the same full-span area. Below the 1050px
breakpoint (sidebar already collapses out of the `.app` grid) drawers fall
back to `left: 0` so there's no dead gap.

*Correction from an earlier pass today that anchored the panels to the left
and slid them in from the left — that wasn't what was wanted; the ask was
for the open state to reach full width while keeping the existing
right-hand slide-in.*

**Deliberately excluded: Plant Explorer.** Its `.pe-drawer-panel` stays a
full-screen overlay — it needs the whole canvas for the zone map and
per-reactor cutaways, per the existing code comment in
`plant-explorer.css`.

### Files touched
- `frankie/css/styles.css` — `.assess-panel` and `.wr-panel` full-span.
- `frankie/css/evidence-vault.css` — removed `.ev-panel` width cap.
- `frankie/css/nuccolpedia.css` — removed `.np-panel` width cap.

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
