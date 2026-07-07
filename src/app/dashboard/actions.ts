"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyUsers } from "@/lib/notify";
import { DAY_NAMES, formatDate } from "@/lib/format";
import { isLeaveCategory, leaveLabel } from "@/lib/leave";
import type { PreferenceLevel } from "@/lib/types";

export async function saveAvailability(formData: FormData) {
  const session = await requireProfile();
  const employeeId = session.userId;
  const orgId = session.profile!.org_id;
  const name = session.profile!.full_name ?? "A team member";

  const supabase = await createClient();

  // Marking a day UNAVAILABLE needs manager approval; anything else applies
  // immediately. Already-approved unavailable days stay approved.
  const { data: existing } = await supabase
    .from("employee_preferences")
    .select("*")
    .eq("employee_id", employeeId);
  const prev = new Map(
    ((existing ?? []) as { day_of_week: number; preference: string; status?: string }[]).map(
      (p) => [p.day_of_week, p],
    ),
  );

  const rows = [];
  const pendingDays: number[] = [];
  for (let d = 0; d < 7; d++) {
    const pref = String(formData.get(`day_${d}`) ?? "available") as PreferenceLevel;
    const was = prev.get(d);
    const alreadyApprovedUnavailable =
      was?.preference === "unavailable" && (was?.status ?? "approved") === "approved";
    const status =
      pref === "unavailable" && !alreadyApprovedUnavailable ? "pending" : "approved";
    if (status === "pending") pendingDays.push(d);
    rows.push({ org_id: orgId, employee_id: employeeId, day_of_week: d, preference: pref, status });
  }

  const { error } = await supabase
    .from("employee_preferences")
    .upsert(rows, { onConflict: "employee_id,day_of_week" });
  if (error) {
    // Migration 11 not run yet: save without the approval flow.
    await supabase
      .from("employee_preferences")
      .upsert(
        rows.map((r) => ({
          org_id: r.org_id,
          employee_id: r.employee_id,
          day_of_week: r.day_of_week,
          preference: r.preference,
        })),
        { onConflict: "employee_id,day_of_week" },
      );
  } else if (pendingDays.length > 0) {
    const { data: managers } = await supabase
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("role", "manager");
    await notifyUsers(
      supabase,
      (managers ?? []).map((m) => m.id),
      {
        title: "Availability change needs approval",
        body: `${name} wants to be unavailable on ${pendingDays
          .map((d) => DAY_NAMES[d])
          .join(", ")}.`,
        link: "/manager/leave",
        type: "availability_request",
      },
    );
  }

  revalidatePath("/dashboard/availability");
}

/** Day-specific "I can't work this date" — pending until the manager approves. */
export async function requestDayOff(formData: FormData) {
  const session = await requireProfile();
  const orgId = session.profile!.org_id!;
  const name = session.profile!.full_name ?? "A team member";
  const date = String(formData.get("work_date") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!date) return;

  const supabase = await createClient();
  const row = { org_id: orgId, employee_id: session.userId, work_date: date, reason };
  const { error } = await supabase
    .from("availability_exceptions")
    .upsert({ ...row, status: "pending" }, { onConflict: "employee_id,work_date" });
  if (error) {
    await supabase
      .from("availability_exceptions")
      .upsert(row, { onConflict: "employee_id,work_date" });
  }

  const { data: managers } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("role", "manager");
  await notifyUsers(
    supabase,
    (managers ?? []).map((m) => m.id),
    {
      title: "Day-off request",
      body: `${name} can't work on ${formatDate(date)}${reason ? ` — ${reason}` : ""}.`,
      link: "/manager/leave",
      type: "availability_request",
      dedupeKey: `dayoff:${session.userId}:${date}`,
    },
  );

  revalidatePath("/dashboard/availability");
}

/** Check in to one of your own shifts (attendance, migration 13). */
export async function checkInShift(formData: FormData) {
  const session = await requireProfile();
  const orgId = session.profile!.org_id!;
  const assignmentId = String(formData.get("assignment_id") ?? "");
  if (!assignmentId) return;

  const supabase = await createClient();
  const { data: a } = await supabase
    .from("assignments")
    .select("id, work_date, start_time, end_time, shift_types(start_time, end_time)")
    .eq("id", assignmentId)
    .eq("employee_id", session.userId)
    .single();
  if (!a) return;
  const st = (a.shift_types as unknown as { start_time: string; end_time: string } | null);

  try {
    await supabase.from("attendance").upsert(
      {
        org_id: orgId,
        employee_id: session.userId,
        assignment_id: a.id,
        work_date: a.work_date,
        scheduled_start: a.start_time ?? st?.start_time ?? null,
        scheduled_end: a.end_time ?? st?.end_time ?? null,
        check_in_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,assignment_id" },
    );
  } catch {
    /* migration 13 not run yet */
  }
  revalidatePath("/dashboard/schedule");
}

export async function checkOutShift(formData: FormData) {
  const session = await requireProfile();
  const assignmentId = String(formData.get("assignment_id") ?? "");
  if (!assignmentId) return;

  const supabase = await createClient();
  try {
    await supabase
      .from("attendance")
      .update({ check_out_at: new Date().toISOString() })
      .eq("assignment_id", assignmentId)
      .eq("employee_id", session.userId);
  } catch {
    /* migration 13 not run yet */
  }
  revalidatePath("/dashboard/schedule");
}

export async function cancelDayOff(formData: FormData) {
  const session = await requireProfile();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("availability_exceptions")
    .delete()
    .eq("id", id)
    .eq("employee_id", session.userId);

  revalidatePath("/dashboard/availability");
}

export async function submitLeave(formData: FormData) {
  const session = await requireProfile();
  const orgId = session.profile!.org_id!;
  const name = session.profile!.full_name ?? "A team member";

  const category = String(formData.get("category") ?? "");
  const start = String(formData.get("start_date") ?? "");
  const end = String(formData.get("end_date") ?? "");
  if (!isLeaveCategory(category) || !start || !end || end < start) return;

  const supabase = await createClient();
  await supabase.from("leave_requests").insert({
    org_id: orgId,
    employee_id: session.userId,
    category,
    start_date: start,
    end_date: end,
  });

  // Always notify every manager so they can approve.
  const { data: managers } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("role", "manager");

  await notifyUsers(
    supabase,
    (managers ?? []).map((m) => m.id),
    {
      title: "New leave request",
      body: `${name} — ${leaveLabel(category)}: ${formatDate(start)} – ${formatDate(end)}`,
      link: "/manager/leave",
      type: "leave_request",
    },
  );

  revalidatePath("/dashboard/leave");
}

export async function requestCoverage(formData: FormData) {
  const session = await requireProfile();
  const orgId = session.profile!.org_id!;
  const name = session.profile!.full_name ?? "A team member";
  const assignmentId = String(formData.get("assignment_id") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!assignmentId) return;

  const supabase = await createClient();

  // Avoid duplicate open requests for the same shift.
  const { data: existing } = await supabase
    .from("coverage_requests")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("status", "open")
    .maybeSingle();
  if (existing) {
    revalidatePath("/dashboard/coverage");
    return;
  }

  await supabase.from("coverage_requests").insert({
    org_id: orgId,
    requester_id: session.userId,
    assignment_id: assignmentId,
    note,
  });

  // Broadcast to everyone else in the org.
  const { data: coworkers } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .neq("id", session.userId);

  await notifyUsers(
    supabase,
    (coworkers ?? []).map((c) => c.id),
    {
      title: "Shift cover needed",
      body: `${name} needs cover${note ? `: ${note}` : ""}`,
      link: "/dashboard/coverage",
      type: "coverage_gap",
    },
  );

  revalidatePath("/dashboard/coverage");
  revalidatePath("/dashboard/schedule");
}

export async function claimCoverage(formData: FormData) {
  const session = await requireProfile();
  const name = session.profile!.full_name ?? "A team member";
  const coverageId = String(formData.get("coverage_id") ?? "");
  if (!coverageId) return;

  const supabase = await createClient();
  const { data: requesterId, error } = await supabase.rpc("claim_coverage", {
    p_coverage_id: coverageId,
  });
  if (error) return;

  if (requesterId) {
    await notifyUsers(supabase, [requesterId as string], {
      title: "Your shift will be covered",
      body: `${name} is covering your shift.`,
      link: "/dashboard/coverage",
      type: "coverage_claimed",
    });
  }

  revalidatePath("/dashboard/coverage");
  revalidatePath("/dashboard/schedule");
}
