-- ============================================================================
-- Addendum A: schedule versions for the repair -> preview -> publish loop.
-- Run ONCE in the Supabase SQL Editor. Safe to re-run. ADDITIVE ONLY.
-- Reversible via 09-schedule-versions-down.sql.
--
-- A "version" is a numbered change to the org's schedule. Auto-fill creates a
-- DRAFT version whose proposed assignments live in `proposal` (jsonb) — they
-- never leak into the live roster. Publishing applies the proposal to
-- `assignments`, stamps publisher + time, and supersedes the previous version.
-- ============================================================================

create table if not exists public.schedule_versions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  period_id    uuid references public.schedule_periods (id) on delete cascade,
  version      int  not null,
  status       text not null default 'draft'
                 check (status in ('draft', 'published', 'superseded')),
  note         text,
  -- Draft repair payload: proposed assignment changes awaiting confirmation.
  proposal     jsonb,
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (org_id, version)
);

alter table public.assignments
  add column if not exists schedule_version_id uuid
    references public.schedule_versions (id) on delete set null;

-- Backfill: every existing period becomes version 1..N (creation order) so
-- the version counter starts correctly. Idempotent: only runs when the org
-- has no versions yet.
insert into public.schedule_versions (org_id, period_id, version, status, note)
select p.org_id, p.id,
       row_number() over (partition by p.org_id order by p.created_at),
       case when p.status = 'published' then 'published' else 'draft' end,
       'Backfilled from existing schedule'
from public.schedule_periods p
where not exists (select 1 from public.schedule_versions v where v.org_id = p.org_id);

-- Next version number for an org (row-locked against the versions table to
-- avoid duplicates under concurrency).
create or replace function public.next_schedule_version(p_org uuid)
returns int language sql volatile security definer set search_path = public as $$
  select coalesce(max(version), 0) + 1 from public.schedule_versions where org_id = p_org;
$$;
grant execute on function public.next_schedule_version(uuid) to authenticated;

-- RLS: org members read, managers write (house pattern).
alter table public.schedule_versions enable row level security;

drop policy if exists sv_select on public.schedule_versions;
create policy sv_select on public.schedule_versions
  for select to authenticated using (org_id = public.current_org_id());
drop policy if exists sv_write on public.schedule_versions;
create policy sv_write on public.schedule_versions
  for all to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (public.is_manager() and org_id = public.current_org_id());

create index if not exists idx_sv_org_version on public.schedule_versions (org_id, version desc);
