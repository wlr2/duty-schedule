-- ============================================================================
-- DOWN migration for 12-fairness.sql — removes the fairness snapshot columns.
-- ============================================================================

alter table public.schedule_periods
  drop column if exists fairness,
  drop column if exists fairness_score;
