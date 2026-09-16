-- nr_skills_entries — one row per (person, skill area): the general Skills
-- Matrix, modelled on the toolbox's PEOP-02 Skills Matrix.xlsx "Skills
-- Matrix" tab. Rating scale matches that template exactly (0=No knowledge,
-- 1=Awareness, 2=Trained (supervised), 3=Competent (independent),
-- 4=Expert (can train others)) so the on-screen tool and the xlsx template
-- companies may already know stay consistent.
--
-- Deliberately separate from nr_sqep_entries — SQEP is a formal
-- authorisation record with statutory weight (ISO 19443), skills tracking
-- is a broader capability/training-planning tool (PEOP-02's own
-- Capability Gap Analysis tab). Both reference the shared nr_personnel
-- roster so a company enters staff once.
--
-- Added 2026-09-16, same Supabase project/RLS shape as
-- nr_self_assessment_answers.sql.

create table if not exists nr_skills_entries (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references nr_companies(id) on delete cascade,
  personnel_id  uuid not null references nr_personnel(id) on delete cascade,
  skill_area    text not null,
  rating        int  not null default 0 check (rating between 0 and 4),
  mandatory     boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists nr_skills_entries_company_idx on nr_skills_entries (company_id);
create index if not exists nr_skills_entries_personnel_idx on nr_skills_entries (personnel_id);

alter table nr_skills_entries enable row level security;

create policy nr_skills_entries_member_select
  on nr_skills_entries for select
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
    or auth.role() = 'authenticated'
  );

create policy nr_skills_entries_member_write
  on nr_skills_entries for insert
  with check (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );

create policy nr_skills_entries_member_update
  on nr_skills_entries for update
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );

create policy nr_skills_entries_member_delete
  on nr_skills_entries for delete
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );

create or replace function nr_skills_entries_touch()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists nr_skills_entries_touch_trigger on nr_skills_entries;
create trigger nr_skills_entries_touch_trigger
  before update on nr_skills_entries
  for each row execute function nr_skills_entries_touch();
