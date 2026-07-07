import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AssistantChat } from "./assistant-chat";

// Server wrapper: loads the most recent conversation so navigating away and
// back never loses the chat. "Save & end chat" is what starts a fresh one.
export default async function AssistantPage() {
  const session = await requireManager();
  const profile = session.profile!;
  const supabase = await createClient();

  // Load the newest conversation that wasn't explicitly ended (migration 11);
  // if the ended_at column doesn't exist yet, fall back to the newest one.
  const q = await supabase
    .from("assistant_conversations")
    .select("id, messages")
    .eq("org_id", profile.org_id)
    .is("ended_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let data = q.data;
  if (q.error) {
    const retry = await supabase
      .from("assistant_conversations")
      .select("id, messages")
      .eq("org_id", profile.org_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    data = retry.data;
  }

  return (
    <AssistantChat
      initialConversationId={(data?.id as string) ?? null}
      initialMessages={Array.isArray(data?.messages) ? data.messages : []}
    />
  );
}
