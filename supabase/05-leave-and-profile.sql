-- ============================================================================
-- Formal leave (structured reasons + approval) + employee profile scaffolding.
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
-- ============================================================================

-- 1. Structured leave reason.
alter table public.leave_requests add column if not exists category text;
alter table public.leave_requests drop constraint if exists leave_requests_category_check;
alter table public.leave_requests
  add constraint leave_requests_category_check
  check (category is null or category in ('medical', 'overseas', 'compassionate', 'annual', 'other'));

-- 2. Pay scaffolding on the profile (modular — UI added later).
alter table public.profiles add column if not exists pay_type text;            -- 'hourly' | 'salary' | null
alter table public.profiles add column if not exists pay_rate numeric;
alter table public.profiles add column if not exists overtime_multiplier numeric;

-- 3. Approve a leave request: confirm it, then free that employee's shifts on
--    those dates into open gaps + log a coverage request for each. Manager-only.
--    Returns how many shifts were opened.
create or replace function public.approve_leave(p_leave_id uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_mgr_org uuid;
  v_org     uuid;
  v_emp     uuid;
  v_start   date;
  v_end     date;
  v_count   int := 0;
  d         date;
  r         record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select org_id into v_mgr_org from public.profiles where id = auth.uid() and role = 'manager';
  if v_mgr_org is null then raise exception 'Only a manager can approve leave'; end if;

  select org_id, employee_id, start_date, end_date
    into v_org, v_emp, v_start, v_end
  from public.leave_requests where id = p_leave_id;

  if v_org is null or v_org is distinct from v_mgr_org then
    raise exception 'Leave request not found';
  end if;

  update public.leave_requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_leave_id;

  d := v_start;
  while d <= v_end loop
    insert into public.availability_exceptions (org_id, employee_id, work_date, reason)
    values (v_org, v_emp, d, 'Approved leave')
    on conflict (employee_id, work_date) do nothing;

    for r in
      select a.id,
             coalesce(a.start_time, st.start_time) as s,
             coalesce(a.end_time, st.end_time)     as e,
             st.name                               as pos
      from public.assignments a
      left join public.shift_types st on st.id = a.shift_type_id
      where a.employee_id = v_emp and a.work_date = d and a.status <> 'open'
    loop
      update public.assignments set employee_id = null, status = 'open' where id = r.id;
      insert into public.coverage_requests
        (org_id, requester_id, assignment_id, status, work_date, start_time, end_time, position_label, note)
      values
        (v_org, v_emp, r.id, 'open', d, r.s, r.e, r.pos, 'Approved leave');
      v_count := v_count + 1;
    end loop;

    d := d + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.approve_leave(uuid) to authenticated;
