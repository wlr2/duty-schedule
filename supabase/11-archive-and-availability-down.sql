-- ============================================================================
-- DOWN migration for 11-archive-and-availability.sql.
-- NOTE: revert archived schedules to published first, or this fails.
-- ============================================================================

update public.schedule_periods set status = 'published' where status = 'archived';
alter table public.schedule_periods drop constraint if exists schedule_periods_status_check;
alter table public.schedule_periods
  add constraint schedule_periods_status_check
  check (status in ('draft', 'published'));

drop policy if exists prefs_manager_review on public.employee_preferences;
drop policy if exists ae_manager_review on public.availability_exceptions;
alter table public.employee_preferences drop column if exists status;
alter table public.availability_exceptions drop column if exists status;

drop index if exists public.idx_ac_active;
alter table public.assistant_conversations drop column if exists ended_at;
