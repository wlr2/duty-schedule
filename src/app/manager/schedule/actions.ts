"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateForPeriod, type PeriodLite } from "@/lib/schedule-runner";
import { storeFairnessForPeriod } from "@/lib/fairness";

export async function createPeriodAndGenerate(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id!;
  const start = String(formData.get("start_date") ?? "");
  const end = String(formData.get("end_date") ?? "");
  if (!start || !end || end < start) return;

  const supabase = await createClient();
  const { data: period, error } = await supabase
    .from("schedule_periods")
    .insert({ org_id: orgId, start_date: start, end_date: end, status: "draft" })
    .select("id, start_date, end_date")
    .single();
  if (error || !period) return;

  await generateForPeriod(supabase, orgId, period as PeriodLite);
  revalidatePath("/manager/schedule");
  redirect(`/manager/schedule/${period.id}`);
}

export async function regeneratePeriod(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id!;
  const periodId = String(formData.get("period_id") ?? "");
  if (!periodId) return;

  const supabase = await createClient();
  const { data: period } = await supabase
    .from("schedule_periods")
    .select("id, start_date, end_date")
    .eq("id", periodId)
    .eq("org_id", orgId)
    .single();
  if (!period) return;

  await generateForPeriod(supabase, orgId, period as PeriodLite);
  revalidatePath(`/manager/schedule/${periodId}`);
}

export async function publishPeriod(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;
  const periodId = String(formData.get("period_id") ?? "");
  if (!periodId) return;

  const supabase = await createClient();
  await supabase
    .from("schedule_periods")
    .update({ status: "published" })
    .eq("id", periodId)
    .eq("org_id", orgId);

  // Publishing stamps a fresh fairness snapshot (manual edits count too).
  await storeFairnessForPeriod(supabase, orgId!, periodId);

  revalidatePath(`/manager/schedule/${periodId}`);
  revalidatePath("/manager/schedule");
}

/** Archive a published schedule: hides it from the main list (and from the
 *  gap detector's "scheduled dates"). Requires migration 11. */
export async function archivePeriod(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;
  const periodId = String(formData.get("period_id") ?? "");
  if (!periodId) return;

  const supabase = await createClient();
  await supabase
    .from("schedule_periods")
    .update({ status: "archived" })
    .eq("id", periodId)
    .eq("org_id", orgId)
    .eq("status", "published");

  revalidatePath("/manager/schedule");
}

export async function unarchivePeriod(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;
  const periodId = String(formData.get("period_id") ?? "");
  if (!periodId) return;

  const supabase = await createClient();
  await supabase
    .from("schedule_periods")
    .update({ status: "published" })
    .eq("id", periodId)
    .eq("org_id", orgId)
    .eq("status", "archived");

  revalidatePath("/manager/schedule");
}

/** Delete straight from the list page (no redirect needed). */
export async function deletePeriodFromList(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;
  const periodId = String(formData.get("period_id") ?? "");
  if (!periodId) return;

  const supabase = await createClient();
  await supabase.from("schedule_periods").delete().eq("id", periodId).eq("org_id", orgId);

  revalidatePath("/manager/schedule");
}

// Works for both draft and published schedules.
export async function deletePeriod(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;
  const periodId = String(formData.get("period_id") ?? "");
  if (!periodId) return;

  const supabase = await createClient();
  await supabase.from("schedule_periods").delete().eq("id", periodId).eq("org_id", orgId);

  revalidatePath("/manager/schedule");
  redirect("/manager/schedule");
}
