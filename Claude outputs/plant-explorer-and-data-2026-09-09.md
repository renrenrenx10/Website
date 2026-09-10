# Plant Explorer data — closing summary, 2026-09-09

Closing summary of the underlying data work. For the frontend/UX changes built on top of this, see the companion doc `frankie-chat-ux-changes-2026-09-09.md`. For the detailed methodology behind the classification passes referenced here, see `claude/reactor-bom-dse-classification-handover.md` and `claude/generic-bolster-frankie-provenance.md` in this project.

## Where the data lives

- **Master workbook**: `Reactor_BOM_DSE_Mapping_v3.xlsx`, on Rene's PC at `Feed_Frankie/Reactors/`.
- **Controlling taxonomy**: `Nuccol_Plant_Data/Data Structure Extract.xlsx` — 171 valid (Plant System, Plant Component) pairs, the single source of truth for what a valid classification looks like.
- **What the live site actually reads**: `frankie/images/plant-explorer/plant_tree_v2.json` in the site repo — a static export built by `regen_tree.py`, not a live connection to the workbook. Any workbook change needs a regenerate-and-copy step to reach the site (see below).

## Numbers, start to finish

| Measure | Project start | Before this session | After this session |
|---|---|---|---|
| Blank `Plant Component` | 15,963 | 3,573 | 1,605 |
| Classified rows | — | 25,150 (87.6%) | 27,118 (94.4%) |
| Orphan rows (`Plant Component` filled, `Plant System` blank — invisible to the 94.4% figure) | — | 1,072 | **131** |
| Invalid pairs (not in the 171-pair dictionary) | — | 902 | 0 |
| Known-bad RCS/Health-Physics pair | — | 78 | 0 |

The 94.4% "classified" figure predates this session's own contribution and undercounted the real state — it doesn't account for orphan rows, which is what this session mainly fixed.

## What this session did

Five classification passes were run by a separate Claude ("Opus") session this session handed off to, taking blanks from 3,573 → 1,605. Independently verified against the live workbook afterwards — every headline number checked out exactly.

This session's own direct contribution: found that **1,072 rows had a `Plant Component` filled in but `Plant System` left blank** — invisible to the 94.4%-classified metric, but these rows still rendered as "Unclassified System" in the actual Plant Explorer tool. Root cause: `regen_tree.py` falls back to "Unclassified System" whenever `Plant System` is blank, regardless of whether `Plant Component` is filled.

Fixed with `apply_orphan_system_fix.py` — a **deterministic dictionary lookup**, not a statistical majority vote: if a `Plant Component` maps to exactly one `Plant System` anywhere in the 171-pair dictionary, use it; otherwise try `(Component, Location)` together; otherwise leave it for manual review. Backed up the workbook, dry-ran (941 rows, matched the pre-computed figure exactly), then applied with `--confirm`.

**Result: 941 of 1,072 orphan rows fixed. 131 left as genuinely ambiguous**, logged to `Reactors/orphan_system_fix_needs_review.csv` — dominated by "Heating and Ventilation" in the Auxiliary Building, where the dictionary itself lists two valid candidate systems and there's no way to pick between them without a human call or document-level evidence.

Regenerated the Plant Explorer tree afterwards (`regen_tree.py` + extract `plant_tree_v2.json` from the output HTML + copy into the site repo) so the fix actually reached the live tool, not just the workbook.

## Two systematic mislabels found and fixed (by the Opus passes, verified this session)

1. **Cooling Towers — 869 rows.** Containment domes, basemats, shield-building structure, core catchers, and other concrete/civil items were classified as `Circulating Water Cycle / Cooling Towers`, purely because `(Circulating Water Cycle, Cooling Towers)` is a genuinely valid pair for the `Concrete & Cement` commodity group — an automated pass applied it to every concrete row with no counter-example anywhere in the workbook.
2. **Emergency Diesel Generator Structure — 242 rows.** Nearly every diesel generator was filed under the *Structure* component rather than the machine — 240 of 242 carried the `Diesel Generators` commodity group and named an actual diesel unit ("Diesel Generator Unit", "EDG Set (10 kV)").

## Known remaining gaps (not actioned this session)

- **131 ambiguous orphan rows** — logged, needs either a human decision on the Heating/Ventilation split or document-level investigation.
- **1,605 rows still blank** after the five Opus passes (breakdown: Materials Plate & Bar 219, Instrumentation 184, Materials Forgings 173, Tanks 157, Fuel Other & Fuel Systems 152, Structural Steel 117, no Commodity Group at all 87, Power Supply/Doors & Hatches/Vessels 198, other 318). ~418 of these carry a Section_Number that could be joined against source PDFs; ~973 source PDFs (~3.8GB) sit untouched in the reactor folders as the next-best route.
- **Materials Forgings / Plate & Bar / Structural Steel bulk-mapping** — Rene asked whether these could map to a generic BOP/Site bucket. Evidence said no for Forgings and Plate & Bar (genuinely system-specific), partial yes for Structural Steel & Sections in the non-building-specific subset only (~34 rows). Not applied — open if he wants to revisit.
- **Taxonomy/buildings extraction pipeline** (`extract_taxonomy.py`, separate from the workbook) — two real bugs fixed this session, but only AP1000 gets genuine per-system building attachment; ABWR/ESBWR/APR1400/US_APWR need per-vendor ITAAC table parsing that wasn't attempted.

## Feature idea raised, not built: a link to the underlying database

Discussed but not implemented. Three options, cheapest first:
1. Link straight to the raw xlsx hosted on Blob/SharePoint — minutes of work, but needs production sign-off and hands out the raw file.
2. A lightweight hosted JSON + searchable table page inside the site repo (same pattern as `plant_tree_v2.json`) — about an hour, no production sign-off needed, recommended starting point.
3. A full mini-database UI matching Plant Explorer's styling — worth it only if this becomes a regularly-used reference.

Scope (whole workbook vs. just the 171-pair DSE dictionary) not yet decided.
