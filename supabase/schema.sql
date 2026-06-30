-- ============================================================================
-- Duty Scheduler — database schema
-- Paste this whole file into the Supabase SQL Editor and click "Run".
-- Safe to re-run: it drops and recreates policies/functions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  join_code   text not null unique,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  org_id                uuid references public.organizations (id) on delete cascade,
  full_name             text,
  role                  text not null default 'employee' check (role in ('manager', 'employee')),
  target_hours_per_week numeric not null default 40,
  created_at            timestamptz not null default now()
);

create table if not exists public.shift_types (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  name           text not null,
  start_time     time not null,
  end_time       time not null,
  color          text not null default '#2563eb',
  required_staff int  not null default 1,
  created_at     timestamptz not null default now()
);

create table if not exists public.employee_preferences (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  day_of_week int  not null check (day_of_week between 0 and 6), -- 0 = Sunday
  preference  text not null default 'available'
                check (preference in ('preferred', 'available', 'unavailable')),
  updated_at  timestamptz not null default now(),
  unique (employee_id, day_of_week)
);

create table if not exists public.schedule_periods (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  start_date date not null,
  end_date   date not null,
  status     text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  period_id     uuid references public.schedule_periods (id) on delete cascade,
  shift_type_id uuid references public.shift_types (id) on delete set null,
  employee_id   uuid references public.profiles (id) on delete set null,
  work_date     date not null,
  status        text not null default 'scheduled'
                  check (status in ('scheduled', 'open', 'swapped')),
  created_at    timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  type        text not null default 'leave' check (type in ('leave', 'mc')),
  start_date  date not null,
  end_date    date not null,
  reason      text,
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.coverage_requests (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete cascade,
  note          text,
  status        text not null default 'open' check (status in ('open', 'claimed', 'closed')),
  claimed_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  body       text,
  link       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER bypasses RLS to avoid recursion)
-- ----------------------------------------------------------------------------

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'manager'
  );
$$;

-- Manager creates a new organization and becomes its manager.
create or replace function public.create_org_and_manager(p_org_name text, p_full_name text)
returns table (org_id uuid, join_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_org  uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  loop
    v_code := upper(substr(md5(random()::text), 1, 6));
    exit when not exists (select 1 from public.organizations o where o.join_code = v_code);
  end loop;

  insert into public.organizations (name, join_code, created_by)
  values (p_org_name, v_code, auth.uid())
  returning id into v_org;

  insert into public.profiles (id, org_id, full_name, role)
  values (auth.uid(), v_org, p_full_name, 'manager')
  on conflict (id) do update
    set org_id = excluded.org_id, full_name = excluded.full_name, role = 'manager';

  return query select v_org, v_code;
end;
$$;

-- Employee joins an existing organization by its join code.
create or replace function public.join_org_by_code(p_code text, p_full_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select id into v_org from public.organizations where join_code = upper(trim(p_code));
  if v_org is null then
    raise exception 'Invalid join code';
  end if;

  insert into public.profiles (id, org_id, full_name, role)
  values (auth.uid(), v_org, p_full_name, 'employee')
  on conflict (id) do update
    set org_id = excluded.org_id, full_name = excluded.full_name;

  return v_org;
end;
$$;

-- An employee claims an open coverage request. Reassigns the shift to them
-- (assignments are otherwise manager-only, so this runs as SECURITY DEFINER).
-- Returns the original requester's id so the app can notify them.
create or replace function public.claim_coverage(p_coverage_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org        uuid;
  v_requester  uuid;
  v_assignment uuid;
  v_caller_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select org_id, requester_id, assignment_id
    into v_org, v_requester, v_assignment
  from public.coverage_requests
  where id = p_coverage_id and status = 'open';

  if v_org is null then
    raise exception 'This coverage request is no longer available';
  end if;

  select org_id into v_caller_org from public.profiles where id = auth.uid();
  if v_caller_org is distinct from v_org then
    raise exception 'Not in this organization';
  end if;
  if v_requester = auth.uid() then
    raise exception 'You cannot cover your own request';
  end if;

  update public.coverage_requests
    set status = 'claimed', claimed_by = auth.uid()
  where id = p_coverage_id;

  if v_assignment is not null then
    update public.assignments
      set employee_id = auth.uid(), status = 'swapped'
    where id = v_assignment;
  end if;

  return v_requester;
end;
$$;

grant execute on function public.create_org_and_manager(text, text) to authenticated;
grant execute on function public.join_org_by_code(text, text) to authenticated;
grant execute on function public.claim_coverage(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

alter table public.organizations       enable row level security;
alter table public.profiles            enable row level security;
alter table public.shift_types         enable row level security;
alter table public.employee_preferences enable row level security;
alter table public.schedule_periods    enable row level security;
alter table public.assignments         enable row level security;
alter table public.leave_requests      enable row level security;
alter table public.coverage_requests   enable row level security;
alter table public.notifications       enable row level security;
alter table public.push_subscriptions  enable row level security;

-- organizations: members can read their org.
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations
  for select to authenticated using (id = public.current_org_id());

-- profiles: read coworkers; edit self; managers edit anyone in their org.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (org_id = public.current_org_id());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or (public.is_manager() and org_id = public.current_org_id()))
  with check (org_id = public.current_org_id());

-- Generic helper: a table scoped to the caller's org, managers write, all read.
-- shift_types
drop policy if exists shift_types_select on public.shift_types;
create policy shift_types_select on public.shift_types
  for select to authenticated using (org_id = public.current_org_id());
drop policy if exists shift_types_write on public.shift_types;
create policy shift_types_write on public.shift_types
  for all to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (public.is_manager() and org_id = public.current_org_id());

-- employee_preferences: employees manage their own; managers read all in org.
drop policy if exists prefs_select on public.employee_preferences;
create policy prefs_select on public.employee_preferences
  for select to authenticated
  using (org_id = public.current_org_id());
drop policy if exists prefs_write on public.employee_preferences;
create policy prefs_write on public.employee_preferences
  for all to authenticated
  using (employee_id = auth.uid())
  with check (employee_id = auth.uid() and org_id = public.current_org_id());

-- schedule_periods: all read; managers write.
drop policy if exists periods_select on public.schedule_periods;
create policy periods_select on public.schedule_periods
  for select to authenticated using (org_id = public.current_org_id());
drop policy if exists periods_write on public.schedule_periods;
create policy periods_write on public.schedule_periods
  for all to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (public.is_manager() and org_id = public.current_org_id());

-- assignments: all read; managers write.
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated using (org_id = public.current_org_id());
drop policy if exists assignments_write on public.assignments;
create policy assignments_write on public.assignments
  for all to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (public.is_manager() and org_id = public.current_org_id());

-- leave_requests: employees create/read own; managers read+update all in org.
drop policy if exists leave_select on public.leave_requests;
create policy leave_select on public.leave_requests
  for select to authenticated
  using (employee_id = auth.uid() or (public.is_manager() and org_id = public.current_org_id()));
drop policy if exists leave_insert on public.leave_requests;
create policy leave_insert on public.leave_requests
  for insert to authenticated
  with check (employee_id = auth.uid() and org_id = public.current_org_id());
drop policy if exists leave_update on public.leave_requests;
create policy leave_update on public.leave_requests
  for update to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- coverage_requests: all in org read; employees create own; anyone in org claims.
drop policy if exists coverage_select on public.coverage_requests;
create policy coverage_select on public.coverage_requests
  for select to authenticated using (org_id = public.current_org_id());
drop policy if exists coverage_insert on public.coverage_requests;
create policy coverage_insert on public.coverage_requests
  for insert to authenticated
  with check (requester_id = auth.uid() and org_id = public.current_org_id());
drop policy if exists coverage_update on public.coverage_requests;
create policy coverage_update on public.coverage_requests
  for update to authenticated
  using (org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- notifications: read/update own; any org member may create one for a coworker.
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications
  for insert to authenticated
  with check (exists (
    select 1 from public.profiles p
    where p.id = notifications.user_id and p.org_id = public.current_org_id()
  ));

-- push_subscriptions: manage own only.
drop policy if exists push_all on public.push_subscriptions;
create policy push_all on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Helpful indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_profiles_org on public.profiles (org_id);
create index if not exists idx_assignments_period on public.assignments (period_id);
create index if not exists idx_assignments_emp on public.assignments (employee_id);
create index if not exists idx_leave_org on public.leave_requests (org_id);
create index if not exists idx_notif_user on public.notifications (user_id, read);
