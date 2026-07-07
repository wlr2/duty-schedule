-- ============================================================================
-- DOWN migration for 13-relaxations-attendance.sql.
-- WARNING: drops all recorded rule-bend history and check-in data.
-- ============================================================================

drop table if exists public.attendance;
drop table if exists public.relaxations;
