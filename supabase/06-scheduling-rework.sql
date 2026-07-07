-- ============================================================================
-- Scheduling rework, Phase 1: unified staffing model.
-- Run ONCE in the Supabase SQL Editor (after 05-leave-and-profile.sql).
-- Safe to re-run. Fully reversible via 06-scheduling-rework-down.sql.
--
-- ADDITIVE ONLY: no existing table, column, or row is dropped or renamed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enums (guarded so re-runs don't fail)
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.staffing_model as enum ('standing', 'shift', 'continuous_coverage');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.employment_type as enum ('full_time', 'part_time', 'contingent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.assignment_source as enum ('pattern', 'manual', 'solver');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. People: employment type + personal work-rule overrides.
--    min_rest_hours/max_consecutive_days are per-person hard limits the solver
--    respects (null max_consecutive_days = no limit).
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists employment_type public.employment_type not null default 'full_time';
alter table public.profiles
  add column if not exists min_rest_hours int not null default 0 check (min_rest_hours >= 0);
alter table public.profiles
  add column if not exists max_consecutive_days int check (max_consecutive_days > 0);

-- ----------------------------------------------------------------------------
-- 3. Positions: declare which staffing model drives them.
--    Everything existing today is continuous coverage (the implemented core).
-- ----------------------------------------------------------------------------
alter table public.shift_types
  add column if not exists staffing_model public.staffing_model not null default 'continuous_coverage';

-- ----------------------------------------------------------------------------
-- 4. KEYSTONE: coverage_requirements — headcount demand per time window.
--    day_of_week null = applies every day. Multiple rows per position allow
--    e.g. "2 people 08:00-20:00" + "1 person 20:00-08:00".
-- ----------------------------------------------------------------------------
create table if not exists public.coverage_requirements (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  position_id   uuid not null references public.shift_types (id) on delete cascade,
  day_of_week   int check (day_of_week between 0 and 6), -- 0 = Sunday; null = daily
  start_time    time not null,
  end_time      time not null,
  min_headcount int  not null default 1 check (min_headcount >= 0),
  max_headcount int  check (max_headcount >= min_headcount),
  created_at    timestamptz not null default now()
);

-- Backfill: one daily requirement per existing position, mirroring its current
-- window + required_staff. Idempotent: only fills positions with no rows yet.
insert into public.coverage_requirements
  (org_id, position_id, day_of_week, start_time, end_time, min_headcount)
select st.org_id, st.id, null, st.start_time, st.end_time, st.required_staff
from public.shift_types st
where not exists (
  select 1 from public.coverage_requirements cr where cr.position_id = st.id
);

-- ----------------------------------------------------------------------------
-- 5. Standing (full-time) recurring patterns. Exceptions, not re-planning.
-- ----------------------------------------------------------------------------
create table if not exists public.standing_assignments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  employee_id    uuid not null references public.profiles (id) on delete cascade,
  position_id    uuid not null references public.shift_types (id) on delete cascade,
  day_of_week    int  not null check (day_of_week between 0 and 6),
  start_time     time not null,
  end_time       time not null,
  effective_from date not null default current_date,
  effective_to   date,
  created_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 6. Assignments: where each row came from + manual lock the solver must keep.
--    All existing rows were engine-generated, hence default 'solver'.
-- ----------------------------------------------------------------------------
alter table public.assignments
  add column if not exists source public.assignment_source not null default 'solver';
alter table public.assignments
  add column if not exists locked boolean not null default false;

-- ----------------------------------------------------------------------------
-- 7. Coverage gaps: derived rows written by the gap detector (Phase 4).
--    The unique key doubles as the dedupe/debounce key: re-detection upserts
--    instead of spamming new rows.
-- ----------------------------------------------------------------------------
create table if not exists public.coverage_gaps (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  position_id    uuid not null references public.shift_types (id) on delete cascade,
  requirement_id uuid references public.coverage_requirements (id) on delete set null,
  work_date      date not null,
  start_time     time not null,
  end_time       time not null,
  required       int  not null,
  staffed        int  not null,
  resolved       boolean not null default false,
  detected_at    timestamptz not null default now(),
  unique (position_id, work_date, start_time, end_time)
);

-- ----------------------------------------------------------------------------
-- 8. Notifications: machine-readable type/payload + idempotency key so the
--    same event never notifies the same person twice.
-- ----------------------------------------------------------------------------
alter table public.notifications add column if not exists type text;
alter table public.notifications add column if not exists data jsonb;
alter table public.notifications add column if not exists dedupe_key text;
create unique index if not exists idx_notif_dedupe
  on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

-- ----------------------------------------------------------------------------
-- RLS (house pattern: org members read, managers write)
-- ----------------------------------------------------------------------------
alter table public.coverage_requirements enable row level security;
alter table public.standing_assignments  enable row level security;
alter table public.coverage_gaps         enable row level security;

drop policy if exists covreq_select on public.coverage_requirements;
create policy covreq_select on public.coverage_requirements
  for select to authenticated using (org_id = public.current_org_id());
drop policy if exists covreq_write on public.coverage_requirements;
create policy covreq_write on public.coverage_requirements
  for all to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (public.is_manager() and org_id = public.current_org_id());

drop policy if exists standing_select on public.standing_assignments;
create policy standing_select on public.standing_assignments
  for select to authenticated using (org_id = public.current_org_id());
drop policy if exists standing_write on public.standing_assignments;
create policy standing_write on public.standing_assignments
  for all to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (public.is_manager() and org_id = public.current_org_id());

drop policy if exists gaps_select on public.coverage_gaps;
create policy gaps_select on public.coverage_gaps
  for select to authenticated using (org_id = public.current_org_id());
drop policy if exists gaps_write on public.coverage_gaps;
create policy gaps_write on public.coverage_gaps
  for all to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (public.is_manager() and org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_covreq_position on public.coverage_requirements (position_id);
create index if not exists idx_standing_emp on public.standing_assignments (employee_id);
create index if not exists idx_gaps_org_date on public.coverage_gaps (org_id, work_date) where not resolved;

-- ----------------------------------------------------------------------------
-- Realtime: stream gap changes to clients (matches 04's pattern).
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.coverage_gaps;
  exception when others then null; end;
end $$;
