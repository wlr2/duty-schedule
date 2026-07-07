"use server";

import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Marks a conversation finished so it is never reloaded as the active chat.
 *  (Needs migration 11's ended_at column; silently no-ops before that.) */
export async function endConversation(conversationId: string) {
  const session = await requireManager();
  const orgId = session.profile!.org_id!;
  if (!conversationId) return;

  const supabase = await createClient();
  try {
    await supabase
      .from("assistant_conversations")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("org_id", orgId);
  } catch {
    /* column not there yet — chat still clears client-side */
  }
}
