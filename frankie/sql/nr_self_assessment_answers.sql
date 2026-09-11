-- nr_self_assessment_answers — a member's own self-declared answer to one
-- practice self-assessment question, one (company, assessment_type, section,
-- q) triple. Added 2026-09-11 so assessment-drawer.js's answers survive
-- closing the drawer / a later session, instead of living only in in-memory
-- state (the gap noted in frankie_blueprint_v14.docx §10).
--
-- q is 1-based to match nr_evidence_analysis's own (section, q) convention
-- (assessment_data.json's question array is 0-based internally; q here is
-- that index + 1) — so a self-declared score and the evidence AI's read for
-- the exact same question sit on the same key, which is what lets the
-- Pre-OSV Pack (Feature C) show a self-declared-vs-AI comparison instead of
-- just the AI read on its own.
--
-- Confirmed with Rene 2026-09-11: unlike nr_evidence_analysis, SCC does not
-- get a write/override path here — the real score gets verified at the
-- actual assessment (a different system entirely), not adjusted by SCC
-- inside Frankie. SCC only needs read access, same view-only trust model as
-- everything else in this schema without a DB-level staff-role check yet.

create table if not exists nr_self_assessment_answers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references nr_companies(id) on delete cascade,
  assessment_type text not null check (assessment_type in ('be','f4n')),
  section      text not null,
  q            int  not null check (q > 0),
  option_idx   int  not null,   -- index into assessment_data.json's q.options[]
  score        int  not null,   -- selected option's score, denormalised so SCC-side reads don't need assessment_data.json
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, assessment_type, section, q)
);

create index if not exists nr_self_assessment_answers_company_idx
  on nr_self_assessment_answers (company_id, assessment_type, section, q);

alter table nr_self_assessment_answers enable row level security;

-- Member: read own company's rows (restores progress on reopen).
-- Any authenticated user (SCC staff): read any company's rows, view-only.
create policy nr_self_assessment_answers_member_select
  on nr_self_assessment_answers for select
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
    or auth.role() = 'authenticated'
  );

-- Member: insert/update only their own company's rows. No SCC write policy
-- on purpose — see header note above.
create policy nr_self_assessment_answers_member_write
  on nr_self_assessment_answers for insert
  with check (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );

create policy nr_self_assessment_answers_member_update
  on nr_self_assessment_answers for update
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );

create or replace function nr_self_assessment_answers_touch()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists nr_self_assessment_answers_touch_trigger on nr_self_assessment_answers;
create trigger nr_self_assessment_answers_touch_trigger
  before update on nr_self_assessment_answers
  for each row execute function nr_self_assessment_answers_touch();
