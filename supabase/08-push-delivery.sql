-- ============================================================================
-- Push delivery support: the app server (acting as the signed-in user) must
-- read ORG-MATES' push subscriptions to deliver a browser push to them
-- (e.g. employee submits leave -> manager's devices get pinged). RLS keeps
-- push_subscriptions self-only, so this SECURITY DEFINER RPC exposes exactly
-- one safe path: subscriptions of members of the CALLER'S OWN org, only.
-- Run ONCE in the Supabase SQL Editor. Safe to re-run.
-- Reversible via 08-push-delivery-down.sql.
-- ============================================================================

create or replace function public.get_org_push_subscriptions(p_user_ids uuid[])
returns table (user_id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select ps.user_id, ps.endpoint, ps.p256dh, ps.auth
  from public.push_subscriptions ps
  join public.profiles p on p.id = ps.user_id
  where ps.user_id = any(p_user_ids)
    and p.org_id = public.current_org_id()
    and auth.uid() is not null;
$$;

grant execute on function public.get_org_push_subscriptions(uuid[]) to authenticated;

-- Dead-endpoint cleanup: the sender may delete subscriptions that the push
-- service reports as gone (404/410), even when they belong to an org-mate.
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions ps
  using public.profiles p
  where ps.endpoint = p_endpoint
    and p.id = ps.user_id
    and p.org_id = public.current_org_id()
    and auth.uid() is not null;
$$;

grant execute on function public.delete_push_subscription(text) to authenticated;
