-- nr_evidence_analysis — shared AI-analysis result for one uploaded evidence
-- file, one (company, BE section, question) triple. Added 2026-09-10 as the
-- shared data model behind Blueprint Features B (SCC Evidence Vault v2),
-- F (company Document Upload & Review), and C (Pre-OSV Pack) — one engine,
-- written once per file, read by both the member-side Evidence Vault drawer
-- and scc.html's per-company Evidence tab.
--
-- BE-only pilot: section/q values must match frankie/kb/be_evidence_map.json
-- and the 'be' key of frankie/kb/assessment_data.json (verified 1:1 aligned
-- for BE at the time this was written — 6 sections x 10 questions each).
--
-- Security model: mirrors nr_site_settings, the only precedent in this schema
-- for a table both a member and SCC staff touch. There is no DB-level staff
-- role anywhere in this project today (confirmed with Rene 2026-09-10) — SCC
-- staff access is gated by scc.html being a separate, manually-provisioned
-- login surface, not by RLS. So writes here follow the same real trust
-- boundary that already exists for nr_site_settings, rather than a stricter
-- model the project has no infrastructure for yet:
--   - a member can only write rows for their OWN company (member_user_id =
--     auth.uid(), via nr_companies — the same join due-diligence-drawer.js
--     already uses)
--   - any authenticated user can SELECT and UPDATE any row (this is what
--     lets scc.html read every company's rows and write scc_override_score/
--     scc_notes, exactly like nr_site_settings' upsert works today)
-- If a real staff-role mechanism gets built later, tighten the UPDATE policy
-- below to check it instead of loosening further.

create table if not exists nr_evidence_analysis (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references nr_companies(id) on delete cascade,
  assessment_type     text not null default 'be' check (assessment_type = 'be'), -- BE-only for this pilot
  section            text not null,
  q                  int  not null check (q between 1 and 10),
  evidence_storage_path text not null,          -- evidence-docs/{userId}/{section-slug}/Q{n}__{filename}
  ai_suggested_score int,                       -- matches assessment_data.json options[].score scale (0/2/7/10)
  ai_rationale       text,
  ai_model           text,                      -- e.g. 'claude-sonnet-4-6' — which model produced this read
  status             text not null default 'pending'
                       check (status in ('pending','analyzed','scc_reviewed')),
  scc_override_score int,
  scc_notes          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, assessment_type, section, q, evidence_storage_path)
);

create index if not exists nr_evidence_analysis_company_idx
  on nr_evidence_analysis (company_id, section, q);

alter table nr_evidence_analysis enable row level security;

-- Member: can see their own company's rows (needed so the Evidence Vault
-- drawer can show "already analyzed" state back to the uploading company).
create policy nr_evidence_analysis_member_select
  on nr_evidence_analysis for select
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
    or auth.role() = 'authenticated' -- also covers SCC staff reading any company, per the trust model above
  );

-- Member: can insert/update analysis rows only for their own company (this
-- is the write path the Evidence Vault drawer's "Analyze" action uses).
create policy nr_evidence_analysis_member_write
  on nr_evidence_analysis for insert
  with check (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );

create policy nr_evidence_analysis_member_update
  on nr_evidence_analysis for update
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
    or auth.role() = 'authenticated' -- lets scc.html write scc_override_score/scc_notes on any row, same as nr_site_settings today
  );

-- Trigger to keep updated_at honest on every write.
create or replace function nr_evidence_analysis_touch()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists nr_evidence_analysis_touch_trigger on nr_evidence_analysis;
create trigger nr_evidence_analysis_touch_trigger
  before update on nr_evidence_analysis
  for each row execute function nr_evidence_analysis_touch();
