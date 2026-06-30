"use server";

import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyUsers } from "@/lib/notify";
import { formatDate } from "@/lib/format";

export async function createShiftType(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;

  const name = String(formData.get("name") ?? "").trim();
  const start = String(formData.get("start_time") ?? "");
  const end = String(formData.get("end_time") ?? "");
  const required = Math.max(1, Number(formData.get("required_staff") ?? 1));
  const color = String(formData.get("color") ?? "#2563eb");

  if (!name || !start || !end) return;

  const supabase = await createClient();
  await supabase.from("shift_types").insert({
    org_id: orgId,
    name,
    start_time: start,
    end_time: end,
    required_staff: required,
    color,
  });

  revalidatePath("/manager/team");
}

export async function deleteShiftType(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("shift_types").delete().eq("id", id).eq("org_id", orgId);

  revalidatePath("/manager/team");
}

export async function updateEmployeeHours(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;
  const employeeId = String(formData.get("employee_id") ?? "");
  const hours = Math.max(0, Number(formData.get("target_hours_per_week") ?? 0));
  if (!employeeId) return;

  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({ target_hours_per_week: hours })
    .eq("id", employeeId)
    .eq("org_id", orgId);

  revalidatePath("/manager/team");
}

export async function reviewLeave(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;
  const id = String(formData.get("id") ?? "");
  const decision =
    String(formData.get("decision") ?? "") === "approved" ? "approved" : "rejected";
  if (!id) return;

  const supabase = await createClient();
  const { data: leave } = await supabase
    .from("leave_requests")
    .update({
      status: decision,
      reviewed_by: session.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", orgId)
    .select("employee_id, type, start_date, end_date")
    .single();

  if (leave) {
    await notifyUsers(supabase, [leave.employee_id], {
      title: `Your ${leave.type === "mc" ? "MC" : "leave"} was ${decision}`,
      body: `${formatDate(leave.start_date)} – ${formatDate(leave.end_date)}`,
      link: "/dashboard/leave",
    });
  }

  revalidatePath("/manager/leave");
}
