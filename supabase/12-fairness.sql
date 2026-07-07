-- ============================================================================
-- Fairness snapshot per schedule period (recomputed on generate/publish).
-- Run ONCE in the Supabase SQL Editor (Ctrl+A then Run). Safe to re-run.
-- Reversible via 12-fairness-down.sql.
-- ============================================================================

alter table public.schedule_periods
  add column if not exists fairness jsonb,
  add column if not exists fairness_score numeric(5,1);
