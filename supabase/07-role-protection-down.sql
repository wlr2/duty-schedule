-- ============================================================================
-- DOWN migration for 07-role-protection.sql.
-- Removes the profile-column guard. The recreated onboarding RPCs are left in
-- place: their only change (set_config) is harmless without the trigger.
-- WARNING: running this reopens the employee self-promotion hole.
-- ============================================================================

drop trigger if exists trg_protect_profile_columns on public.profiles;
drop function if exists public.protect_profile_columns();
