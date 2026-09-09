# Task: finish classifying the NucCol Reactor BOM / DSE taxonomy gaps

## Background

NucCol (Nuclear Collaboration Ltd) maintains a master workbook, `Reactor_BOM_DSE_Mapping_v3.xlsx`, that maps components extracted from public reactor design documents (AP1000, ABWR, APR1400, etc. — 18 reactor tabs) onto NucCol's own commodity taxonomy: `Plant System` and `Plant Component` columns (e.g. `Reactor Coolant Systems` / `Reactor Vessel and Internals`). This feeds a Plant Explorer tool used internally and (via a JSON export) in a public-facing widget.

The workbook started this project at **15,963 blank `Plant Component` rows**. A prior session (mine) ran it down to **3,573** through a sequence of automated passes, each backed up and logged. Your job is to keep going on what's left, using the same discipline: evidence-checked, never a blind statistical majority.

## Where everything lives

All paths below are relative to `Reactors/` on the user's machine (folder name: `Feed_Frankie/Reactors`, mounted under the connected-folder path for this session).

- `Reactor_BOM_DSE_Mapping_v3.xlsx` — the master workbook. **Always back it up before writing** (`cp` with a timestamp suffix — see the existing `*.backup-YYYYMMDD-HHMMSS.xlsx` files for the convention already in use).
- `python/` — all the classification scripts, described below.
- `json/{reactor}_taxonomy.json` — per-reactor system taxonomy (system codes, names, DCD/PCSR section numbers, and — for AP1000 only, see below — real building assignments), produced by `python/extract_taxonomy.py`.
- `remaining_unclassified_review.csv` (in `Reactors/`) — every one of the 3,573 remaining blank rows, sorted by Commodity Group cluster size, with component name / CG / Category / Plant Location / Record Origin / Section Number columns. Start here.
- `loose75_autofill_log.csv`, `name_match_autofill_log.csv`, `cg_category_autofill_log.csv`, `fuzzy_match_autofill_log.csv`, `cgloc_autofill_log.csv`, `class1e_cabling_fix_log.csv` — audit trails of everything already applied. Each row shows old/new values, the method, and a confidence score. **Note:** `loose75_autofill_log.csv` currently only shows the last of two runs made in the same session (99 rows) because it was truncated between runs — a 116-row HVAC batch was applied earlier and is not separately logged, but both are already committed to the workbook.

Environment notes: `pdfplumber` and `pdftotext` are available and working for reading source PDFs directly. `PyMuPDF` (`fitz`) is **not** installed and the network may not allow installing it — don't import `build_bom_v3.py` or `build_bom.py` directly (they pull in `fitz` via `extract_bom_v2.py`); copy just the functions you need (`build_lookups`, `resolve_system`, the `_NUM_SECT` regex) the way `apply_loose75_autofill.py` does.

## Methodology already established — follow this, don't reinvent it

Every automated pass so far uses the same shape: for a given signal (Commodity Group, Category, exact Component name, fuzzy Component name, Commodity Group + Plant Location, DCD section → system code), build a majority vote from **already-classified** rows sharing that signal value, and only apply it to a blank row if:

- `N >= 3` to `N >= 5` supporting examples (varies by script — see each script's header comment), and
- the winning `(Plant System, Plant Component)` pair has `>= 75-80%` purity among those examples.

**The purity score is necessary but not sufficient — verify by reading real component names before applying, every time.** This session caught two cases where a signal cleared the threshold but was still wrong:

1. `Pipework Supports` commodity group, 79% purity, N=395 — looked fine statistically, but the actual blank rows being matched were mostly major-component support brackets (RPV support skirts, steam generator supports, control rod drive supports, reactor vessel internals) getting mislabeled as generic piping supports. Excluded.
2. `Tanks` + `Containment Building`, 78% purity, N=97 — looked fine, but every already-classified `Suppression Pool` row anywhere in the workbook uses a completely different classification (piping, valves, containment structure — never "generic holding tank"), because the training examples were dominated by unrelated pressurizer relief tanks. Excluded.

Conversely, a *lower* purity score isn't automatically disqualifying if you can independently verify it — e.g. `Materials Structural Steel & Sections` sits at only 55-61% purity overall, but that's because the DSE category it lands on (`Site Preparation & Structures` / `Earthwork Infrastructure`) is being used as a general civil/structural catch-all bucket rather than literally "earthwork" — worth checking with the user before trusting the name at face value.

There's also a permanent guard (`BAD_PAIRS` in the scripts) for one confirmed-wrong pairing that kept getting re-propagated: `("Reactor Coolant Systems", "Health Physics Equipment and Supplies")`. Keep that guard in anything you write.

## What's left (3,573 rows) — two different problems

**1. ~600 rows with no Commodity Group or Category at all**, all from `Record_Origin = Generic_Bolster_Frankie` — a synthetic supplementary component list layered onto every reactor tab, distinct from the actual document-extracted BOM. Checked: only ~32 of the ~2,350 total Bolster-origin blank rows have an exact-name duplicate anywhere else in the workbook (11 pass a safe confidence bar), meaning most of these are one-off generic names ("Cable Gallery", "Battery Room", "Spring mechanism") with nothing to statistically cross-reference. This population probably needs a different approach — e.g. matching against a canonical component glossary/dictionary rather than cross-reactor majority voting, or accepting these need manual/document review.

**2. ~2,970 rows that do have a Commodity Group**, concentrated in categories that are genuinely used across multiple systems in the real design documents (verified, not assumed — see the Suppression Pool example above):

| Commodity Group | Blank rows | Note |
|---|---|---|
| Materials Forgings | ~330 | 50-57% of real precedent is Reactor Vessel and Internals forgings — genuinely reactor-system-specific, not generic |
| Materials Plate & Bar | ~290 | 62% Containment Structure in Containment Building — also system-specific |
| Materials Structural Steel & Sections | ~250 | Mixed — genuinely generic (Site Prep/Earthwork) when not tied to a specific building, but building-specific when it is (see methodology note above) |
| Fuel Other & Fuel Systems | 320 | Too few precedent examples (N=4) to vote confidently |
| Instrumentation (control/computers/detectors/etc.) | 309 | 1,960 precedent examples but only 37% purity — genuinely spread across many systems |
| Tanks | ~170 remaining after this session's fixes | Same story as Suppression Pool — verify per-cluster before trusting |
| Pumps | ~80 remaining | Same |
| Doors & Hatches, Power Supply, Valves, Vessels, Pipework Supports, Penetrations, Grounding Devices, Cranes & Lifting, Seals & Gaskets | smaller clusters, all previously found too heterogeneous at the standard threshold |

## The taxonomy/buildings pipeline (a separate, partially-fixed sub-project)

`python/extract_taxonomy.py` extracts each reactor's real NRC/ONR system codes (e.g. `RCS`, `FHS`, `PXS`) plus DCD/PCSR section numbers and, where possible, which building each system is in, from the actual Tier 1/Ch1 source PDFs in each reactor's folder. This session fixed two real bugs in it (a header-row misdetection in `parse_buildings`, and missing case-insensitivity in `normalise_building`'s regexes) and re-ran it for all 18 reactors.

**Result: only AP1000 got genuine per-system building data** (31/99 systems correctly attributed, e.g. Reactor Coolant System → Containment, Main Turbine → Turbine Building — spot-checked against the source PDF and correct). ABWR, ESBWR, APR1400, and US_APWR show non-empty `buildings` lists at the top level of their JSON but **zero systems actually got a building attached** — their Tier 1 documents use a different ITAAC table layout than AP1000's "Component Name / Tag No. / Component Location" format, so the building text gets picked up as a bare word list but never linked back to a system code. Fixing that would mean reverse-engineering each vendor's table format individually — not attempted, may or may not be worth the effort depending on how much it would actually unlock (see below).

I also tried joining this taxonomy data (Section_Number → system code → majority-voted Plant System/Component from same-system-code rows) directly against the remaining blanks. **Yield was very low — about 20-30 rows workbook-wide even at a loose threshold**, and on inspection the "name-match" fallback inside `resolve_system()` (in `build_bom_v3.py`, reused via a stripped-down copy in `apply_loose75_autofill.py`) produced clearly wrong pairings (e.g. "Emergency Airlock" → "Environmental Monitoring", "Code Case N-580-1 Steam Dryer Plate" → "Circuit Breakers") because it's a loose word-overlap heuristic, fine for descriptive tagging in the original pipeline but not reliable enough to drive direct classification. **This signal was disabled, not deleted** — it's still in `apply_loose75_autofill.py` guarded by `if False and ...` with a comment explaining why, in case a better resolution method makes it worth revisiting. Don't just flip it back on without fixing the underlying name-match reliability first.

## What to actually do

1. Read `remaining_unclassified_review.csv` and get oriented on the size/shape of each cluster.
2. For each Commodity Group cluster (starting with the biggest — Materials Forgings, Materials Plate & Bar, Instrumentation), don't just re-run statistical majority voting — it's already been tried and these are the leftovers that didn't clear the bar for a reason. Instead:
   - Sample the actual `Component` text for each cluster and see if there's a **sub-pattern** a coarse Commodity Group match misses (e.g. "forgings" containing the word "nozzle" vs "flange" vs "shell" might split cleanly into different real systems even though "Materials Forgings" as a whole doesn't).
   - Where a cluster is concentrated in one reactor's Tier 1/DCD PDFs and looks worth it, read the actual source document (`pdfplumber`/`pdftotext` are available) rather than guessing from the spreadsheet alone — this is exactly how the Class 1E Cabling fix (203 rows, in `apply_class1e_cabling_fix.py`) and the HVAC/Cranes-Pumps fixes this session were done, and it's the most defensible way to close genuinely ambiguous cases.
   - For the Generic_Bolster_Frankie population (~600 rows with no CG at all), consider whether there's a canonical glossary or the original source list this bolster data came from that could serve as a lookup table instead of cross-reactor statistics.
3. Whatever you apply, write a script following the existing pattern (backup workbook first, build training data from already-classified rows, apply with a stated threshold, log every change to a CSV with old/new values and method/score, dry-run before `--confirm`).
4. Stop and flag for human review rather than guessing when you can't find real evidence — the user has said explicitly this needs a human check at some point, and the CSV log is what makes that possible. Don't sacrifice that discipline for a bigger fill count.
5. When done, regenerate the Plant Explorer tree so the fixes actually reach the tool: `cd "Plant Explorer" && REACTORS_DIR="<path to Reactors>" python3 regen_tree.py`, then extract the updated `PLANT_TREE` JSON from the regenerated HTML and copy it into the live site's `frankie/images/plant-explorer/plant_tree_v2.json` (see the git status / push section the user has separately for what needs deploying — this data file counts as one of those).

## Constraints

- Local file edits, KB rebuilds, and direct edits to `Reactor_BOM_DSE_Mapping_v3.xlsx` are fine to do proactively.
- Do **not** push to the live website git repo, touch the Cloudflare Worker, or do anything else to shared/production/auth-gated infrastructure without explicit sign-off from the user first.
