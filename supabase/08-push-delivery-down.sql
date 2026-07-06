-- ============================================================================
-- DOWN migration for 08-push-delivery.sql — removes the push RPCs.
-- In-app notifications keep working; browser push delivery stops.
-- ============================================================================

drop function if exists public.get_org_push_subscriptions(uuid[]);
drop function if exists public.delete_push_subscription(text);
