-- nr_quiz_completions — a member's completion record for one Compliance
-- Training Quiz (Feature E, blueprint frankie_blueprint_v15.docx §10).
-- One row per attempt (not upserted per-topic) so a retake doesn't erase the
-- history — "SCC can view/export a training register" needs the full
-- completion record, not just the latest.
--
-- Unlike nr_self_assessment_answers/nr_evidence_analysis, there is no
-- override concept here: a quiz score is a plain, objective right/wrong
-- count against fixed correct answers, not a maturity judgement call, so
-- there's nothing for SCC to adjust.

create table if not exists nr_quiz_completions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references nr_companies(id) on delete cascade,
  quiz_topic     text not null,   -- key into compliance_quiz_data.json, e.g. 'cyber_essentials'
  score          int  not null check (score >= 0),
  total          int  not null check (total > 0),
  pass_mark_pct  int  not null,   -- the passMark this attempt was judged against, in case it changes later
  passed         boolean not null,
  completed_at   timestamptz not null default now()
);

create index if not exists nr_quiz_completions_company_idx
  on nr_quiz_completions (company_id, quiz_topic, completed_at desc);

alter table nr_quiz_completions enable row level security;

-- Member: read own company's completion history (so the drawer can show
-- "you last passed this on ..." rather than only the current session).
-- Any authenticated user (SCC staff): read any company's rows, for the
-- training register — same view-only trust model as everything else in
-- this schema without a DB-level staff-role check yet.
create policy nr_quiz_completions_member_select
  on nr_quiz_completions for select
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
    or auth.role() = 'authenticated'
  );

-- Member: insert completion rows only for their own company. No update/
-- delete policy - a completion record is a fact about what happened, not
-- something either side edits after the fact.
create policy nr_quiz_completions_member_insert
  on nr_quiz_completions for insert
  with check (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );
