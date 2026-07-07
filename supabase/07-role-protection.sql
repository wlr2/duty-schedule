-- ============================================================================
-- Security fix: employees could UPDATE their own profile row, including
-- role/org/pay — a privilege-escalation hole. This trigger locks sensitive
-- columns to managers, while onboarding RPCs sanction their own changes via a
-- transaction-local flag. Run ONCE in the Supabase SQL Editor. Safe to re-run.
-- Reversible via 07-role-protection-down.sql.
-- ============================================================================

create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Sanctioned by an onboarding RPC (create_org_and_manager / join_org_by_code)
  if coalesce(current_setting('app.allow_profile_admin', true), '') = '1' then
    return new;
  end if;
  -- Managers may change anything in their org (RLS already scopes the rows)
  if public.is_manager() then
    return new;
  end if;
  -- Everyone else: block changes to privileged columns on their own row
  if new.role                  is distinct from old.role
     or new.org_id                is distinct from old.org_id
     or new.target_hours_per_week is distinct from old.target_hours_per_week
     or new.employment_type       is distinct from old.employment_type
     or new.min_rest_hours        is distinct from old.min_rest_hours
     or new.max_consecutive_days  is distinct from old.max_consecutive_days
     or new.pay_type              is distinct from old.pay_type
     or new.pay_rate              is distinct from old.pay_rate
     or new.overtime_multiplier   is distinct from old.overtime_multiplier
  then
    raise exception 'Only a manager can change roles, organization, hours or pay';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile_columns on public.profiles;
create trigger trg_protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- ----------------------------------------------------------------------------
-- Onboarding RPCs, recreated with the sanction flag so signup keeps working
-- (identical to schema.sql versions except the set_config line).
-- ----------------------------------------------------------------------------

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

  perform set_config('app.allow_profile_admin', '1', true);

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

create or replace function public.join_org_by_code(p_code text, p_full_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  perform set_config('app.allow_profile_admin', '1', true);

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

grant execute on function public.create_org_and_manager(text, text) to authenticated;
grant execute on function public.join_org_by_code(text, text) to authenticated;
