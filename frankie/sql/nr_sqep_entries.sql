-- nr_sqep_entries — one row per (person, SQEP activity): the ISO 19443
-- SQEP authorisation record, field-for-field modelled on the toolbox's own
-- NSS-05e Nuclear Competence and Authorisation Register template, whose own
-- instructions tab calls it "the primary document demonstrating SQEP
-- compliance under ISO 19443... one of the most frequently audited
-- documents by nuclear clients and the F4N assessment."
--
-- Three-stage authorisation, per NSS-05e: Stage 1 = knowledge training
-- completed, Stage 2 = demonstrated competence (observed assessment
-- passed), Stage 3 = formal authorisation granted. All three required
-- before someone works unsupervised on nuclear ITNS activities.
--
-- status is computed and written client-side (sqep-skills-drawer.js), not
-- a DB-generated column, so the "expiring soon" threshold (within 3
-- months, same threshold NSS-05e's own dashboard tab defines) stays easy
-- to read/adjust from one place in the UI code rather than in SQL.
--
-- Added 2026-09-16, same Supabase project/RLS shape as
-- nr_self_assessment_answers.sql. References nr_personnel (added
-- alongside this file) rather than duplicating name/job title per row.

create table if not exists nr_sqep_entries (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references nr_companies(id) on delete cascade,
  personnel_id            uuid not null references nr_personnel(id) on delete cascade,
  activity                text not null,   -- "Authorised Activity / Scope" in NSS-05e
  qualification_required  text,
  qualification_held      text,
  cert_ref                text,
  issue_date              date,
  expiry_date             date,
  stage1_complete         boolean not null default false,
  stage2_complete         boolean not null default false,
  stage3_granted          boolean not null default false,
  status                  text not null default 'not_started'
                            check (status in ('not_started','in_progress','current','expiring_soon','expired')),
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists nr_sqep_entries_company_idx on nr_sqep_entries (company_id);
create index if not exists nr_sqep_entries_personnel_idx on nr_sqep_entries (personnel_id);

alter table nr_sqep_entries enable row level security;

create policy nr_sqep_entries_member_select
  on nr_sqep_entries for select
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
    or auth.role() = 'authenticated'
  );

create policy nr_sqep_entries_member_write
  on nr_sqep_entries for insert
  with check (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );

create policy nr_sqep_entries_member_update
  on nr_sqep_entries for update
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );

create policy nr_sqep_entries_member_delete
  on nr_sqep_entries for delete
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );

create or replace function nr_sqep_entries_touch()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists nr_sqep_entries_touch_trigger on nr_sqep_entries;
create trigger nr_sqep_entries_touch_trigger
  before update on nr_sqep_entries
  for each row execute function nr_sqep_entries_touch();
