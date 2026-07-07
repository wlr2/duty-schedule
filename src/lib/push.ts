// Server-side browser push sender (Web Push / VAPID).
// Reads org-mates' subscriptions via the SECURITY DEFINER RPC from migration
// 08, sends with web-push, and prunes endpoints the push service says are
// dead. Everything is best-effort: a push failure must never break the
// user-facing action that triggered it.
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PushPayload {
  title: string;
  body?: string | null;
  link?: string | null;
  tag?: string | null;
}

function vapidReady(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

export async function sendPushTo(
  supabase: SupabaseClient,
  userIds: string[],
  payload: PushPayload,
): Promise<void> {
  if (!vapidReady() || userIds.length === 0) return;

  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );

    const { data, error } = await supabase.rpc("get_org_push_subscriptions", {
      p_user_ids: userIds,
    });
    if (error || !data) return; // RPC missing (migration 08 not run) or none

    const subs = data as { user_id: string; endpoint: string; p256dh: string; auth: string }[];
    const body = JSON.stringify({
      title: payload.title,
      body: payload.body ?? "",
      link: payload.link ?? "/notifications",
      tag: payload.tag ?? undefined,
    });

    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 60 * 60 },
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // Subscription is gone (browser revoked it) — clean it up.
            await supabase.rpc("delete_push_subscription", { p_endpoint: s.endpoint });
          }
        }
      }),
    );
  } catch (err) {
    console.error("Push send failed (non-fatal):", err);
  }
}
