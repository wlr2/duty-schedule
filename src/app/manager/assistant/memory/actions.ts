"use server";

import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { validateMemoryPath } from "@/lib/assistant-memory";

export async function saveMemoryFile(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id!;
  const path = validateMemoryPath(String(formData.get("path") ?? ""));
  if (!path || path === "/memories") return;
  const content = String(formData.get("content") ?? "");

  const supabase = await createClient();
  await supabase
    .from("assistant_memories")
    .upsert(
      { org_id: orgId, path, content, updated_at: new Date().toISOString() },
      { onConflict: "org_id,path" },
    );
  revalidatePath("/manager/assistant/memory");
}

export async function deleteMemoryFile(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id!;
  const path = validateMemoryPath(String(formData.get("path") ?? ""));
  if (!path || path === "/memories") return;

  const supabase = await createClient();
  await supabase.from("assistant_memories").delete().eq("org_id", orgId).eq("path", path);
  revalidatePath("/manager/assistant/memory");
}

/** The spec's "wipe all memory for this org" action. */
export async function wipeAllMemory() {
  const session = await requireManager();
  const orgId = session.profile!.org_id!;

  const supabase = await createClient();
  await supabase.from("assistant_memories").delete().eq("org_id", orgId);
  revalidatePath("/manager/assistant/memory");
}
