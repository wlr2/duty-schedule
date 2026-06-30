// Creates in-app notifications. RLS allows an org member to notify any other
// member of the same org, so this runs fine as the acting user.
// (Phone push notifications are layered on in Step 6.)
import type { SupabaseClient } from "@supabase/supabase-js";

export interface NotificationInput {
  title: string;
  body?: string | null;
  link?: string | null;
}

export async function notifyUsers(
  supabase: SupabaseClient,
  userIds: string[],
  n: NotificationInput,
) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return;

  const rows = ids.map((user_id) => ({
    user_id,
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
  }));

  await supabase.from("notifications").insert(rows);
}
