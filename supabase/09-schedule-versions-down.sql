-- ============================================================================
-- DOWN migration for 09-schedule-versions.sql.
-- WARNING: drops the version history (assignments themselves are untouched).
-- ============================================================================

drop function if exists public.next_schedule_version(uuid);
alter table public.assignments drop column if exists schedule_version_id;
drop table if exists public.schedule_versions;
