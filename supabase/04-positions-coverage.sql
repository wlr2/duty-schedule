-- ============================================================================
-- Revamp: concurrent coverage positions, eligibility, availability, gap log.
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

-- 1. Positions config (shift_types are now "positions").
--    required_staff = how many people must be on this position AT ONCE.
--    start_time/end_time = the coverage window.
--    block_minutes = rotation length (null = one continuous shift across window).
--    min_rest_minutes = rest required between a person's blocks (0 = none).
alter table public.shift_types add column if not exists block_minutes int;
alter table public.shift_types add column if not exists min_rest_minutes int not null default 0;

-- 2. Who can work a position (qualifications). Empty for a position = everyone
--    is eligible (the guard-duty case). Set members for role-specific jobs.
create table if not exists public.position_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  position_id uuid not null references public.shift_types (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  unique (position_id, employee_id)
);

-- 3. Per-date unavailability (replaces leave/MC as the trigger for gaps).
create table if not exists public.availability_exceptions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  work_date   date not null,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- 4. Self-describing snapshot + audit fields on coverage requests (the log).
alter table public.coverage_requests add column if not exists work_date date;
alter table public.coverage_requests add column if not exists start_time time;
alter table public.coverage_requests add column if not exists end_time time;
alter table public.coverage_requests add column if not exists position_label text;
alter table public.coverage_requests add column if not exists resolved_at timestamptz;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.position_members        enable row level security;
alter table public.availability_exceptions enable row level security;

drop policy if exists pm_select on public.position_members;
create policy pm_select on public.position_members
  for select to authenticated using (org_id = public.current_org_id());
drop policy if exists pm_write on public.position_members;
create policy pm_write on public.position_members
  for all to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (public.is_manager() and org_id = public.current_org_id());

drop policy if exists ae_select on public.availability_exceptions;
create policy ae_select on public.availability_exceptions
  for select to authenticated
  using (employee_id = auth.uid() or (public.is_manager() and org_id = public.current_org_id()));
drop policy if exists ae_write on public.availability_exceptions;
create policy ae_write on public.availability_exceptions
  for all to authenticated
  using (employee_id = auth.uid() or (public.is_manager() and org_id = public.current_org_id()))
  with check (org_id = public.current_org_id());

-- ----------------------------------------------------------------------------
-- Gap flow RPCs
-- ----------------------------------------------------------------------------

-- Employee declares they can't work a date. Frees their published shifts that
-- day into open gaps + logs a coverage request for each. Returns how many.
create or replace function public.declare_unavailable(p_date date, p_reason text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org   uuid;
  v_count int := 0;
  r       record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select org_id into v_org from public.profiles where id = auth.uid();

  insert into public.availability_exceptions (org_id, employee_id, work_date, reason)
  values (v_org, auth.uid(), p_date, p_reason)
  on conflict (employee_id, work_date) do update set reason = excluded.reason;

  for r in
    select a.id,
           coalesce(a.start_time, st.start_time) as s,
           coalesce(a.end_time, st.end_time)     as e,
           st.name                               as pos_name
    from public.assignments a
    left join public.shift_types st on st.id = a.shift_type_id
    where a.employee_id = auth.uid() and a.work_date = p_date and a.status <> 'open'
  loop
    update public.assignments set employee_id = null, status = 'open' where id = r.id;

    insert into public.coverage_requests
      (org_id, requester_id, assignment_id, status, work_date, start_time, end_time, position_label, note)
    values
      (v_org, auth.uid(), r.id, 'open', p_date, r.s, r.e, r.pos_name, p_reason);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.declare_unavailable(date, text) to authenticated;

-- Claim an open coverage gap: take the shift + stamp the log.
create or replace function public.claim_coverage(p_coverage_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org        uuid;
  v_requester  uuid;
  v_assignment uuid;
  v_caller_org uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

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
    set status = 'claimed', claimed_by = auth.uid(), resolved_at = now()
  where id = p_coverage_id;

  if v_assignment is not null then
    update public.assignments
      set employee_id = auth.uid(), status = 'swapped'
    where id = v_assignment;
  end if;

  return v_requester;
end;
$$;

grant execute on function public.claim_coverage(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Realtime: stream roster + coverage changes to clients.
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.assignments;
  exception when others then null; end;
  begin
    alter publication supabase_realtime add table public.coverage_requests;
  exception when others then null; end;
end $$;
