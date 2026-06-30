-- ============================================================================
-- Seed a guard-duty (Sentry / PAC / VAC) test roster.
-- Run in the Supabase SQL Editor. Safe to re-run (it resets this org's demo
-- data each time).
--
-- Creates seantov@gmail.com as the MANAGER and 9 test employees. Each employee
-- gets a RANDOM rotation of the three 2-hour posts across these blocks:
--   08:00-10:00,  (rest 10:00-12:00),  12:00-14:00,  (rest 14:00-16:00),  16:00-18:00
-- = 6 hours worked with 2-hour rests between each shift.
--
-- This does NOT delete other accounts — run cleanup-keep-seantov.sql for that
-- afterwards, once you've checked the roster looks right.
-- ============================================================================

-- Per-assignment block times (needed for rotating posts). No-op if already added.
alter table public.assignments add column if not exists start_time time;
alter table public.assignments add column if not exists end_time   time;

do $$
declare
  v_sean   uuid;
  v_org    uuid;
  v_join   text;
  v_period uuid;
  v_date   date := current_date;
  v_sentry uuid;
  v_pac    uuid;
  v_vac    uuid;
  v_emp    uuid;
  v_perm   uuid[];
  v_names  text[] := array[
    'Alex Tan','Bryan Lee','Chloe Ng','Daniel Wong','Emma Lim',
    'Farid Rahman','Grace Koh','Hafiz Ali','Irene Goh'];
  i        int;
  v_email  text;
begin
  ----------------------------------------------------------------------------
  -- 1. Ensure the manager account exists (keeps existing password if present).
  ----------------------------------------------------------------------------
  select id into v_sean from auth.users where email = 'seantov@gmail.com';
  if v_sean is null then
    v_sean := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_sean, 'authenticated', 'authenticated',
      'seantov@gmail.com', crypt('DutyRoster123!', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
    insert into auth.identities (id, provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_sean::text, v_sean,
      jsonb_build_object('sub', v_sean::text, 'email', 'seantov@gmail.com'),
      'email', now(), now(), now());
  else
    update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now())
      where id = v_sean;
  end if;

  ----------------------------------------------------------------------------
  -- 2. Ensure an org and make seantov its manager.
  ----------------------------------------------------------------------------
  select org_id into v_org from public.profiles where id = v_sean;
  if v_org is null then
    loop
      v_join := upper(substr(md5(random()::text), 1, 6));
      exit when not exists (select 1 from public.organizations where join_code = v_join);
    end loop;
    insert into public.organizations (name, join_code, created_by)
    values ('HQ Duty Roster', v_join, v_sean) returning id into v_org;
  end if;

  insert into public.profiles (id, org_id, full_name, role, target_hours_per_week)
  values (v_sean, v_org, 'Sean (Manager)', 'manager', 0)
  on conflict (id) do update
    set org_id = excluded.org_id, role = 'manager', full_name = excluded.full_name;

  ----------------------------------------------------------------------------
  -- 3. Reset this org's demo data, then create the three posts + a period.
  ----------------------------------------------------------------------------
  delete from public.schedule_periods where org_id = v_org;            -- cascades assignments
  delete from public.shift_types     where org_id = v_org;
  delete from public.profiles        where org_id = v_org and role = 'employee';

  insert into public.shift_types (org_id, name, start_time, end_time, required_staff, color)
    values (v_org, 'Sentry', '08:00', '10:00', 1, '#dc2626') returning id into v_sentry;
  insert into public.shift_types (org_id, name, start_time, end_time, required_staff, color)
    values (v_org, 'PAC', '12:00', '14:00', 1, '#2563eb') returning id into v_pac;
  insert into public.shift_types (org_id, name, start_time, end_time, required_staff, color)
    values (v_org, 'VAC', '16:00', '18:00', 1, '#16a34a') returning id into v_vac;

  insert into public.schedule_periods (org_id, start_date, end_date, status)
    values (v_org, v_date, v_date, 'published') returning id into v_period;

  ----------------------------------------------------------------------------
  -- 4. Create test employees, each with a random post rotation.
  ----------------------------------------------------------------------------
  for i in 1 .. array_length(v_names, 1) loop
    v_email := 'emp' || i || '@dutyroster.test';
    v_emp := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values (
      '00000000-0000-0000-0000-000000000000', v_emp, 'authenticated', 'authenticated',
      v_email, crypt('Test123!', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');

    insert into auth.identities (id, provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_emp::text, v_emp,
      jsonb_build_object('sub', v_emp::text, 'email', v_email),
      'email', now(), now(), now());

    insert into public.profiles (id, org_id, full_name, role, target_hours_per_week)
    values (v_emp, v_org, v_names[i], 'employee', 6);

    -- Random permutation of the three posts across the three blocks.
    select array_agg(x order by random()) into v_perm
      from unnest(array[v_sentry, v_pac, v_vac]::uuid[]) x;

    insert into public.assignments
      (org_id, period_id, shift_type_id, employee_id, work_date, start_time, end_time, status)
    values
      (v_org, v_period, v_perm[1], v_emp, v_date, '08:00', '10:00', 'scheduled'),
      (v_org, v_period, v_perm[2], v_emp, v_date, '12:00', '14:00', 'scheduled'),
      (v_org, v_period, v_perm[3], v_emp, v_date, '16:00', '18:00', 'scheduled');
  end loop;

  raise notice 'Seeded org % with % employees. Manager = seantov@gmail.com',
    v_org, array_length(v_names, 1);
end $$;
