-- Optional: removes the test accounts/orgs Claude created while verifying the
-- backend, so your database is clean for real use. Run in the SQL Editor.
-- Deleting the org cascades to its shifts/profiles; deleting the auth users
-- cascades to their profiles.

delete from public.organizations where name in ('ACME Test Org', 'Test Clinic');
delete from auth.users where email like 'dutyroster.%@gmail.com';
