-- sor_enquiries_setup.sql
-- Receiving table for the public Nuclear Opportunity Enquiry form.
--
-- Nothing existing is touched: this creates one new table in public, enables
-- RLS on it, and grants only what the form needs.
--
-- GRANTS ARE EXPLICIT AND DELIBERATE. From 30 October 2026 Supabase stops
-- automatically granting Data API access to new tables in public on existing
-- projects, so a table created without grants returns "permission denied" to
-- supabase-js and PostgREST. The grants below are written out in the same
-- migration as the table, which is also what makes this survive a
-- `supabase db reset`, a preview branch, or a rebuild into a new project.
--
-- THE IMPORTANT LINE: anon gets INSERT and nothing else. The form can write an
-- enquiry; the public key cannot read one back. Enquiries contain a named
-- contact, their email and what the company will and will not commit to, so
-- anon must never hold SELECT on this table.
--
-- Safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists public.sor_enquiries (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  source              text not null default 'enquiry-form',
  form_version        text,

  -- who
  company             text not null,
  postcode            text,
  contact_name        text not null,
  contact_role        text,
  contact_email       text not null,

  -- gate
  business_type       text,
  physical_product    text,
  eligible            boolean,

  -- what they supply
  product_groups      jsonb not null default '[]'::jsonb,
  capabilities        jsonb not null default '[]'::jsonb,
  products            jsonb not null default '[]'::jsonb,
  supply_mode         text,
  design_authority    text,

  -- credentials
  management_systems  jsonb not null default '[]'::jsonb,
  design_in_scope     text,
  code_certifications jsonb not null default '[]'::jsonb,
  material_cert       text,
  cfsi_procedure      text,
  approvals           jsonb not null default '[]'::jsonb,
  bodies              jsonb not null default '[]'::jsonb,
  clearances          text,

  -- current position
  markets_served      jsonb not null default '[]'::jsonb,
  sells_to            jsonb not null default '[]'::jsonb,
  nuclear_history     text,
  nuclear_programme   text,

  -- intent
  trigger_reason      text,
  twelve_month_win    text,
  wont_do             jsonb not null default '[]'::jsonb,

  -- the submission exactly as sent, so nothing is lost if the form gains fields
  payload             jsonb not null,

  -- handling
  status              text not null default 'new',
  assigned_to         text,
  notes               text
);

comment on table public.sor_enquiries is
  'Submissions from the public Nuclear Opportunity Enquiry form. anon holds INSERT only — never grant anon SELECT, these rows carry named contacts and commercial constraints.';
comment on column public.sor_enquiries.payload is
  'The whole submission as received. Structured columns above are for querying; this is the record of what was actually sent.';
comment on column public.sor_enquiries.products is
  'Products named by the enquirer. Each carries a source: capability (matched a register tag, so group is set), commodity, material form, or own words. An own-words entry means our vocabulary had no match — worth reviewing.';
comment on column public.sor_enquiries.status is
  'new | acknowledged | researching | reported | declined | spam';

create index if not exists sor_enquiries_created_idx on public.sor_enquiries (created_at desc);
create index if not exists sor_enquiries_status_idx  on public.sor_enquiries (status);
create index if not exists sor_enquiries_company_idx on public.sor_enquiries (lower(company));

-- ── row level security ───────────────────────────────────────────────────────
alter table public.sor_enquiries enable row level security;

-- Anonymous submission, with the shape of a legitimate enquiry enforced in the
-- policy rather than trusted from the client. Keeps the obvious junk out and
-- caps how much a single request can write.
drop policy if exists sor_enquiries_anon_insert on public.sor_enquiries;
create policy sor_enquiries_anon_insert
  on public.sor_enquiries
  for insert
  to anon
  with check (
    char_length(company)       between 1 and 200
    and char_length(contact_name) between 1 and 120
    and char_length(contact_email) <= 200
    and contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and coalesce(char_length(postcode), 0) <= 12
    and coalesce(char_length(trigger_reason), 0) <= 4000
    and coalesce(char_length(twelve_month_win), 0) <= 4000
    and coalesce(char_length(nuclear_programme), 0) <= 500
    and pg_column_size(payload) <= 24576
    and status = 'new'
    and assigned_to is null
    and notes is null
  );

-- Signed-in NucCol staff read and work the enquiries.
drop policy if exists sor_enquiries_auth_all on public.sor_enquiries;
create policy sor_enquiries_auth_all
  on public.sor_enquiries
  for all
  to authenticated
  using (true)
  with check (true);

-- ── grants (required from 30 October 2026) ───────────────────────────────────
grant usage on schema public to anon, authenticated, service_role;

grant insert
  on public.sor_enquiries
  to anon;

grant select, insert, update, delete
  on public.sor_enquiries
  to authenticated;

grant select, insert, update, delete
  on public.sor_enquiries
  to service_role;

notify pgrst, 'reload schema';

-- ── checks ───────────────────────────────────────────────────────────────────

-- 1. grants are as intended: anon INSERT only, no anon SELECT.
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'sor_enquiries'
  and grantee in ('anon', 'authenticated', 'service_role')
group by grantee
order by grantee;

-- 2. RLS on, two policies present.
select relname, relrowsecurity as rls_enabled,
       (select count(*) from pg_policies
         where schemaname = 'public' and tablename = 'sor_enquiries') as policies
from pg_class
where oid = 'public.sor_enquiries'::regclass;

-- 3. Nothing in it yet.
select count(*) as enquiries from public.sor_enquiries;

-- ── afterwards ───────────────────────────────────────────────────────────────
-- Confirm the table is switched on in Dashboard → Settings → API → Data API,
-- under exposed schemas/tables, then submit the form once and re-run check 3.
--
-- To read enquiries without signing in (a script, or a report), use the
-- service_role key server-side only. Never put it in a page.
