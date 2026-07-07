-- ============================================================================
-- Planner analytics: relaxation debt + attendance (check-in/out).
-- Run ONCE in the Supabase SQL Editor (Ctrl+A then Run). Safe to re-run.
-- Reversible via 13-relaxations-attendance-down.sql.
-- ============================================================================

-- 1. Relaxation debt: every time the solver bends a soft rule for someone,
--    the exception is persisted so "who keeps absorbing short rest?" is a
--    query, not archaeology inside proposal jsonb.
create table if not exists public.relaxations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  position_id uuid references public.shift_types (id) on delete set null,
  period_id   uuid references public.schedule_periods (id) on delete cascade,
  version_id  uuid references public.schedule_versions (id) on delete set null,
  work_date   date not null,
  rule        text not null check (rule in ('weekly_hours', 'rest', 'consecutive_days')),
  created_at  timestamptz not null default now()
);

alter table public.relaxations enable row level security;
drop policy if exists relax_select on public.relaxations;
create policy relax_select on public.relaxations
  for select to authenticated
  using (public.is_manager() and org_id = public.current_org_id());
drop policy if exists relax_write on public.relaxations;
create policy relax_write on public.relaxations
  for all to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (public.is_manager() and org_id = public.current_org_id());

create index if not exists idx_relax_org_date on public.relaxations (org_id, work_date desc);
create index if not exists idx_relax_emp on public.relaxations (employee_id, work_date desc);

-- 2. Attendance: employees check in/out of their shifts. Actual-vs-scheduled
--    is the no-show / lateness source of truth.
create table if not exists public.attendance (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  employee_id     uuid not null references public.profiles (id) on delete cascade,
  assignment_id   uuid references public.assignments (id) on delete cascade,
  work_date       date not null,
  scheduled_start time,
  scheduled_end   time,
  check_in_at     timestamptz,
  check_out_at    timestamptz,
  created_at      timestamptz not null default now(),
  unique (employee_id, assignment_id)
);

alter table public.attendance enable row level security;
-- Employees manage their own check-ins; managers see (and can correct) all.
drop policy if exists att_self on public.attendance;
create policy att_self on public.attendance
  for all to authenticated
  using (employee_id = auth.uid())
  with check (employee_id = auth.uid() and org_id = public.current_org_id());
drop policy if exists att_manager on public.attendance;
create policy att_manager on public.attendance
  for all to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

create index if not exists idx_att_org_date on public.attendance (org_id, work_date desc);
