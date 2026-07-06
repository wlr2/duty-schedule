// Creates in-app notifications AND delivers a browser push to each recipient
// (best-effort — push failures never break the triggering action).
// RLS allows an org member to notify any other member of the same org.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushTo } from "@/lib/push";

export interface NotificationInput {
  title: string;
  body?: string | null;
  link?: string | null;
  /** Machine-readable event type, e.g. 'leave_request' | 'leave_decision' | 'coverage_gap'. */
  type?: string | null;
  /** Same (recipient, dedupeKey) never notifies twice — for detector re-runs. */
  dedupeKey?: string | null;
}

export async function notifyUsers(
  supabase: SupabaseClient,
  userIds: string[],
  n: NotificationInput,
) {
  let ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return;

  // Dedupe: drop recipients who already have this exact event.
  if (n.dedupeKey) {
    const { data: existing } = await supabase
      .from("notifications")
      .select("user_id")
      .eq("dedupe_key", n.dedupeKey)
      .in("user_id", ids);
    const seen = new Set((existing ?? []).map((r) => r.user_id as string));
    ids = ids.filter((id) => !seen.has(id));
    if (ids.length === 0) return;
  }

  const rows = ids.map((user_id) => ({
    user_id,
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
    type: n.type ?? null,
    dedupe_key: n.dedupeKey ?? null,
  }));

  await supabase.from("notifications").insert(rows);

  // Browser push (no-op until the recipient enables notifications).
  await sendPushTo(supabase, ids, {
    title: n.title,
    body: n.body,
    link: n.link,
    tag: n.dedupeKey,
  });
}
