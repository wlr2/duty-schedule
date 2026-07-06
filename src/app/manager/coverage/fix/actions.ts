"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildRepairProposal, discardVersion, publishVersion } from "@/lib/repair";

/** Auto-fill: run the solver in repair mode -> draft version -> preview. */
export async function autoFillPeriod(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id!;
  const periodId = String(formData.get("period_id") ?? "");
  if (!periodId) return;

  const supabase = await createClient();
  const versionId = await buildRepairProposal(supabase, orgId, periodId);
  if (!versionId) return;

  redirect(`/manager/coverage/fix/${versionId}`);
}

/** Publish the previewed draft: apply + version bump + broadcast. */
export async function publishDraftVersion(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id!;
  const versionId = String(formData.get("version_id") ?? "");
  if (!versionId) return;

  const supabase = await createClient();
  const ok = await publishVersion(supabase, orgId, versionId, session.userId);
  if (!ok) return;

  revalidatePath("/manager/coverage");
  revalidatePath("/manager/schedule");
  redirect("/manager/coverage?published=1");
}

/** Discard the previewed draft: nothing applied, nobody notified. */
export async function discardDraftVersion(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id!;
  const versionId = String(formData.get("version_id") ?? "");
  if (!versionId) return;

  const supabase = await createClient();
  await discardVersion(supabase, orgId, versionId);
  redirect("/manager/coverage/fix");
}
