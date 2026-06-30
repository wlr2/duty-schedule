-- ============================================================================
-- ⚠️  DESTRUCTIVE — run this only AFTER you've run seed-sentry-roster.sql and
--     checked the roster looks right.
--
-- Deletes EVERY account except:
--   - seantov@gmail.com  (you, the manager)
--   - the seeded test employees  (emp1..emp9@dutyroster.test)
--
-- Deleting a user automatically removes their profile and data. This cannot be
-- undone.
-- ============================================================================

delete from auth.users
where email <> 'seantov@gmail.com'
  and email not like '%@dutyroster.test';
