"use server";

import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyUsers } from "@/lib/notify";
import { detectGaps } from "@/lib/gap-detector";
import { formatDate } from "@/lib/format";
import { leaveLabel } from "@/lib/leave";

export async function createPosition(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;

  const name = String(formData.get("name") ?? "").trim();
  const start = String(formData.get("start_time") ?? "");
  const end = String(formData.get("end_time") ?? "");
  const headcount = Math.max(1, Number(formData.get("headcount") ?? 1));
  const color = String(formData.get("color") ?? "#2563eb");
  const continuous = formData.get("continuous") === "on";
  const rotateHours = Math.max(0.5, Number(formData.get("rotate_hours") ?? 2));
  const restHours = Math.max(0, Number(formData.get("rest_hours") ?? 2));

  if (!name || !start || !end) return;

  const block_minutes = continuous ? null : Math.round(rotateHours * 60);
  const min_rest_minutes = continuous ? 0 : Math.round(restHours * 60);

  const supabase = await createClient();
  await supabase.from("shift_types").insert({
    org_id: orgId,
    name,
    start_time: start,
    end_time: end,
    required_staff: headcount,
    color,
    block_minutes,
    min_rest_minutes,
  });

  revalidatePath("/manager/team");
}

export async function deletePosition(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("shift_types").delete().eq("id", id).eq("org_id", orgId);

  revalidatePath("/manager/team");
}

// Set which employees may work a position. No rows = everyone is eligible.
export async function setEligibility(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;
  const positionId = String(formData.get("position_id") ?? "");
  if (!positionId) return;

  const employeeIds = formData.getAll("employee_ids").map(String).filter(Boolean);

  const supabase = await createClient();
  await supabase.from("position_members").delete().eq("position_id", positionId);
  if (employeeIds.length > 0) {
    await supabase.from("position_members").insert(
      employeeIds.map((employee_id) => ({
        org_id: orgId,
        position_id: positionId,
        employee_id,
      })),
    );
  }

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

export async function setPay(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id;
  const employeeId = String(formData.get("employee_id") ?? "");
  if (!employeeId) return;

  const payTypeRaw = String(formData.get("pay_type") ?? "");
  const pay_type = payTypeRaw === "hourly" || payTypeRaw === "salary" ? payTypeRaw : null;
  const pay_rate = Number(formData.get("pay_rate") ?? 0) || null;
  const overtime_multiplier = Number(formData.get("overtime_multiplier") ?? 0) || null;

  const supabase = await createClient();
  await supabase
    .from("profiles")
    .update({ pay_type, pay_rate, overtime_multiplier })
    .eq("id", employeeId)
    .eq("org_id", orgId);

  revalidatePath(`/manager/staff/${employeeId}`);
}

export async function reviewLeave(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id!;
  const id = String(formData.get("id") ?? "");
  const decision =
    String(formData.get("decision") ?? "") === "approved" ? "approved" : "rejected";
  if (!id) return;

  const supabase = await createClient();
  const { data: leave } = await supabase
    .from("leave_requests")
    .select("employee_id, category, start_date, end_date")
    .eq("id", id)
    .eq("org_id", orgId)
    .single();
  if (!leave) return;

  const dateRange = `${formatDate(leave.start_date)} – ${formatDate(leave.end_date)}`;

  if (decision === "approved") {
    // Confirms the leave AND frees their shifts those days into open gaps.
    const { data: opened } = await supabase.rpc("approve_leave", { p_leave_id: id });

    await notifyUsers(supabase, [leave.employee_id], {
      title: "Leave approved",
      body: `${leaveLabel(leave.category)}: ${dateRange}`,
      link: "/dashboard/leave",
      type: "leave_decision",
    });

    if ((opened ?? 0) > 0) {
      const { data: emp } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", leave.employee_id)
        .single();
      const { data: coworkers } = await supabase
        .from("profiles")
        .select("id")
        .eq("org_id", orgId)
        .neq("id", leave.employee_id);
      await notifyUsers(
        supabase,
        (coworkers ?? []).map((c) => c.id),
        {
          title: "Cover needed",
          body: `${emp?.full_name ?? "A teammate"} is on leave (${dateRange}) — ${opened} shift(s) need cover.`,
          link: "/dashboard/coverage",
          type: "coverage_gap",
        },
      );
    }

    // Addendum A trigger: sweep the affected window only. Detects the new
    // gaps and sends the manager ONE actionable "fix schedule" notification.
    try {
      await detectGaps(supabase, orgId, leave.start_date, leave.end_date);
    } catch {
      /* non-fatal */
    }
  } else {
    await supabase
      .from("leave_requests")
      .update({
        status: "rejected",
        reviewed_by: session.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("org_id", orgId);
    await notifyUsers(supabase, [leave.employee_id], {
      title: "Leave not approved",
      body: dateRange,
      link: "/dashboard/leave",
      type: "leave_decision",
    });
  }

  revalidatePath("/manager/leave");
  revalidatePath("/manager/coverage");
}
