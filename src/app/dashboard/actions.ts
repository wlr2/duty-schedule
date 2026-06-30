"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { notifyUsers } from "@/lib/notify";
import { formatDate } from "@/lib/format";
import type { PreferenceLevel } from "@/lib/types";

export async function saveAvailability(formData: FormData) {
  const session = await requireProfile();
  const employeeId = session.userId;
  const orgId = session.profile!.org_id;

  const rows = [];
  for (let d = 0; d < 7; d++) {
    const pref = String(formData.get(`day_${d}`) ?? "available") as PreferenceLevel;
    rows.push({ org_id: orgId, employee_id: employeeId, day_of_week: d, preference: pref });
  }

  const supabase = await createClient();
  await supabase
    .from("employee_preferences")
    .upsert(rows, { onConflict: "employee_id,day_of_week" });

  revalidatePath("/dashboard/availability");
}

export async function submitLeave(formData: FormData) {
  const session = await requireProfile();
  const orgId = session.profile!.org_id!;
  const name = session.profile!.full_name ?? "A team member";

  const type = String(formData.get("type") ?? "leave") === "mc" ? "mc" : "leave";
  const start = String(formData.get("start_date") ?? "");
  const end = String(formData.get("end_date") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!start || !end || end < start) return;

  const supabase = await createClient();
  await supabase.from("leave_requests").insert({
    org_id: orgId,
    employee_id: session.userId,
    type,
    start_date: start,
    end_date: end,
    reason,
  });

  // Notify all managers in the org.
  const { data: managers } = await supabase
    .from("profiles")
    .select("id")
    .eq("org_id", orgId)
    .eq("role", "manager");

  await notifyUsers(
    supabase,
    (managers ?? []).map((m) => m.id),
    {
      title: `New ${type === "mc" ? "MC" : "leave"} request`,
      body: `${name}: ${formatDate(start)} – ${formatDate(end)}`,
      link: "/manager/leave",
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
    });
  }

  revalidatePath("/dashboard/coverage");
  revalidatePath("/dashboard/schedule");
}
