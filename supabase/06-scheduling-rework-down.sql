-- ============================================================================
-- DOWN migration for 06-scheduling-rework.sql — restores the pre-06 schema.
-- Run in the Supabase SQL Editor only if you need to roll Phase 1 back.
-- WARNING: this DROPS the tables/columns 06 added (and any data put in them).
-- It does NOT touch anything that existed before 06.
-- ============================================================================

-- Realtime
do $$
begin
  begin
    alter publication supabase_realtime drop table public.coverage_gaps;
  exception when others then null; end;
end $$;

-- Tables added by 06 (policies drop with them)
drop table if exists public.coverage_gaps;
drop table if exists public.standing_assignments;
drop table if exists public.coverage_requirements;

-- Columns added by 06
drop index if exists public.idx_notif_dedupe;
alter table public.notifications drop column if exists dedupe_key;
alter table public.notifications drop column if exists data;
alter table public.notifications drop column if exists type;

alter table public.assignments drop column if exists locked;
alter table public.assignments drop column if exists source;

alter table public.shift_types drop column if exists staffing_model;

alter table public.profiles drop column if exists max_consecutive_days;
alter table public.profiles drop column if exists min_rest_hours;
alter table public.profiles drop column if exists employment_type;

-- Enums added by 06 (columns using them are gone by now)
drop type if exists public.assignment_source;
drop type if exists public.employment_type;
drop type if exists public.staffing_model;
