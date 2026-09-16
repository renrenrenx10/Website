-- nr_personnel — a member company's own staff roster. Shared foundation for
-- both the SQEP Register and the Skills Matrix (frankie/js/sqep-skills-drawer.js)
-- so a company enters a person once and tracks both their SQEP authorisations
-- and their general skills against the same record, rather than re-entering
-- staff twice. Added 2026-09-16 as part of the SQEP/Skills Matrix tool
-- (Feature D reframed — see frankie_blueprint_v21 "Where to look next").
--
-- Same Supabase project/keys and RLS shape as nr_self_assessment_answers:
-- member owns their own company's rows, any authenticated user (SCC staff)
-- gets read-only visibility, same "no SCC override" trust model.

create table if not exists nr_personnel (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references nr_companies(id) on delete cascade,
  name         text not null,
  job_title    text,
  department   text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists nr_personnel_company_idx on nr_personnel (company_id);

alter table nr_personnel enable row level security;

create policy nr_personnel_member_select
  on nr_personnel for select
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
    or auth.role() = 'authenticated'
  );

create policy nr_personnel_member_write
  on nr_personnel for insert
  with check (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );

create policy nr_personnel_member_update
  on nr_personnel for update
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );

create policy nr_personnel_member_delete
  on nr_personnel for delete
  using (
    company_id in (select id from nr_companies where member_user_id = auth.uid())
  );

create or replace function nr_personnel_touch()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists nr_personnel_touch_trigger on nr_personnel;
create trigger nr_personnel_touch_trigger
  before update on nr_personnel
  for each row execute function nr_personnel_touch();
