-- Run this ONCE in the Supabase SQL Editor (it enables the "I'll cover this"
-- button). It's also included in schema.sql, so if you ever re-run that whole
-- file you don't need this one. Safe to run more than once.

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

grant execute on function public.claim_coverage(uuid) to authenticated;
