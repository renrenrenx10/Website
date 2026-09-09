# Frankie / Reactor BOM session handover — 2026-09-09

Context for picking this up in a new chat. Written at the end of a session that fixed a data gap, deployed it, and confirmed it live.

## Where things stand right now

- **Master workbook**: `Reactor_BOM_DSE_Mapping_v3.xlsx`, on Rene's PC at `Feed_Frankie/Reactors/` (connected folder: `C:\Users\Rene Dorset\Desktop\Feed_Frankie`).
- **Site repo**: `2026_Website_Update v2` (connected folder: `C:\Users\Rene Dorset\Downloads\2026_Website_Update v2`), pushes to `github.com/renrenrenx10/Website`, deploys via GitHub Actions to Azure Static Web Apps.
- **Live site**: `https://www.nuccol.co.uk` (note the `www` — the bare `nuccol.co.uk` is a separate WordPress hub page that just links out, it is NOT where Frankie/members live).
  - Frankie: `https://www.nuccol.co.uk/frankie/index.html`
  - Members area: `https://www.nuccol.co.uk/members.html`
- **Legacy/archived, not in use**: `frankie_v3_unified_brain` folder on Rene's PC (contains `_ARCHIVED_frankie_app_20260908`), and the old `github.com/renrenrenx10/Frankie` repo. Frankie now pushes from the Website repo above.

## Standing constraint (carry this into any new chat)

> Propose explicitly and get a yes before modifying shared, production, or auth-gated infrastructure like the Cloudflare Worker or Azure Blob storage. Local file edits, KB rebuilds, and direct edits to `Reactor_BOM_DSE_Mapping_v3.xlsx` are fine to do proactively. Git push to the live website repo still needs explicit sign-off — Rene has been doing the actual `git push` himself from his machine after I commit locally.

## What happened this session (in order)

1. Diagnosed and fixed two real bugs in `extract_taxonomy.py` (building-attachment extraction) — documented, only fully benefits AP1000, other vendors need per-vendor table parsing not yet done.
2. Ran a ≥75%-confidence classification pass (`apply_loose75_autofill.py`), 215 rows filled, two would-be-wrong signals caught and excluded before applying (Pipework Supports grab-bag, Air Ejectors mislabel).
3. Wrote an Opus handoff prompt for a separate Claude session to continue the classification work; that session ran 5 more passes and got blanks down from 3,573 → 1,605 (94.4% classified). Independently verified those numbers against the live workbook — checked out exactly, genuinely completed work, not just testing.
4. **Found a gap Opus's headline metrics didn't surface**: 1,072 rows had `Plant Component` filled but `Plant System` blank, so they still rendered as "Unclassified System" in the actual Plant Explorer tool despite counting as "classified" in the spreadsheet metric.
5. Built `apply_orphan_system_fix.py` — a deterministic (not statistical) lookup against the 171-pair `Nuccol_Plant_Data/Data Structure Extract.xlsx` dictionary. Backed up the workbook, dry-ran (941 rows, matched pre-computed figure exactly), then ran with `--confirm`. **941 of 1,072 orphan rows fixed. 131 left as genuinely ambiguous**, logged to `Reactors/orphan_system_fix_needs_review.csv` (dominated by "Heating and Ventilation" in Auxiliary Building — the dictionary itself has two valid candidate systems there, needs a human call).
6. Regenerated the Plant Explorer tree (`regen_tree.py`) and copied the new `plant_tree_v2.json` into the site repo.
7. Committed everything in the site repo (60 files — the data fix plus a backlog of pre-existing uncommitted frontend changes, images, and docs that had been sitting there). Rene pushed it (`657e92e`). Confirmed via GitHub Actions the deploy succeeded, and confirmed live on both `/frankie/index.html` and `/members.html`.

## Open items for next time

- **131 ambiguous orphan rows** in `orphan_system_fix_needs_review.csv` — not actioned, needs either a human decision or document-level investigation (source PDFs) per reactor.
- **Materials Forgings / Plate & Bar / Structural Steel** — Rene asked whether these could bulk-map to a generic BOP/Site bucket. Evidence said no for Forgings and Plate & Bar (genuinely system-specific — Reactor Vessel forgings, Containment Structure plate), partial yes for Structural Steel & Sections only in the non-building-specific location subset (~34 rows). Not applied, Rene said "no it's ok" at the time — open if he wants to revisit.
- **Remaining classification gaps** — whatever's left after Opus's passes and this session's orphan fix; `remaining_unclassified_review.csv` (pre-orphan-fix vintage) is the last full export, may want a fresh one.
- **New feature request (just raised)**: a link from Plant Explorer to the underlying plant database. Three options discussed, recommended starting point is a lightweight hosted JSON + searchable table page (reusing the same JSON-export approach as `plant_tree_v2.json`) rather than exposing the raw xlsx. Scope not yet decided (whole workbook vs. just the DSE dictionary) — needs Rene's steer, then it's about an hour of work, no production-infra sign-off needed if it stays inside the site repo.
- **Git repo housekeeping** — the commit that just went live folded in a backlog of untracked directories (`Nuclear/`, `_misc_files/`, `_to_delete/`, `Claude outputs/`) that predate this session. Nothing was deleted; `_to_delete/` is still sitting there under that name if Rene wants it actually removed.

## Useful reference

- DSE taxonomy dictionary: `Nuccol_Plant_Data/Data Structure Extract.xlsx`, real header row 4, columns at 0-indexed tuple positions: 1=Plant Site, 2=Plant Location, 3=Plant System, 4=Plant Component, 5=Plant Sub Component, 6=Category.
- `regen_tree.py` lives in the `Plant Explorer` connected folder; run with `REACTORS_DIR="<path to Reactors>" python3 regen_tree.py`, then extract `const PLANT_TREE = [...]` from the regenerated HTML and copy into `frankie/images/plant-explorer/plant_tree_v2.json` in the site repo.
- Full classification methodology (majority-vote thresholds, the "Suppression Pool" and "Pipework Supports" traps, BAD_PAIRS guard) is written up in the project docs: `claude/reactor-bom-dse-classification-handover.md` and `claude/generic-bolster-frankie-provenance.md`.
