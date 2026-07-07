-- ============================================================================
-- Batch update: schedule archiving, availability approval, chat end-marker.
-- Run ONCE in the Supabase SQL Editor (Ctrl+A then Run). Safe to re-run.
-- Reversible via 11-archive-and-availability-down.sql.
-- ============================================================================

-- 1. Published schedules can be ARCHIVED (hidden from the main list).
alter table public.schedule_periods drop constraint if exists schedule_periods_status_check;
alter table public.schedule_periods
  add constraint schedule_periods_status_check
  check (status in ('draft', 'published', 'archived'));

-- 2. Employee "unavailable" needs manager approval.
--    Existing rows stay approved; NEW unavailable requests start pending.
alter table public.employee_preferences
  add column if not exists status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected'));
alter table public.availability_exceptions
  add column if not exists status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected'));

-- Managers can update these rows to approve/decline (employees already manage
-- their own rows; add manager write on top).
drop policy if exists prefs_manager_review on public.employee_preferences;
create policy prefs_manager_review on public.employee_preferences
  for update to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

drop policy if exists ae_manager_review on public.availability_exceptions;
create policy ae_manager_review on public.availability_exceptions
  for update to authenticated
  using (public.is_manager() and org_id = public.current_org_id())
  with check (org_id = public.current_org_id());

-- 3. "Save & end chat": ended conversations never reload as the active chat.
alter table public.assistant_conversations
  add column if not exists ended_at timestamptz;

create index if not exists idx_ac_active
  on public.assistant_conversations (org_id, updated_at desc)
  where ended_at is null;
