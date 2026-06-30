"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  datesInRange,
  generateSchedule,
  type SchedulerEmployee,
} from "@/lib/scheduler";
import type {
  EmployeePreference,
  LeaveRequest,
  Profile,
  ShiftType,
} from "@/lib/types";

interface PeriodLite {
  id: string;
  start_date: string;
  end_date: string;
}

/** Load inputs, run the engine, and (re)write assignments for a period. */
async function generateForPeriod(
  supabase: SupabaseClient,
  orgId: string,
  period: PeriodLite,
) {
  const [shiftsRes, empsRes, prefsRes, leavesRes] = await Promise.all([
    supabase.from("shift_types").select("*").eq("org_id", orgId).order("start_time"),
    supabase
      .from("profiles")
      .select("id, full_name, target_hours_per_week")
      .eq("org_id", orgId)
      .eq("role", "employee"),
    supabase
      .from("employee_preferences")
      .select("employee_id, day_of_week, preference")
      .eq("org_id", orgId),
    supabase
      .from("leave_requests")
      .select("employee_id, start_date, end_date, status")
      .eq("org_id", orgId)
      .eq("status", "approved")
      .lte("start_date", period.end_date)
      .gte("end_date", period.start_date),
  ]);

  const shifts = (shiftsRes.data ?? []) as ShiftType[];
  const employees = (empsRes.data ?? []) as Pick<
    Profile,
    "id" | "full_name" | "target_hours_per_week"
  >[];
  const prefs = (prefsRes.data ?? []) as Pick<
    EmployeePreference,
    "employee_id" | "day_of_week" | "preference"
  >[];
  const leaves = (leavesRes.data ?? []) as Pick<
    LeaveRequest,
    "employee_id" | "start_date" | "end_date"
  >[];

  // availability[empId][dow] = preference
  const availability: Record<string, Record<number, EmployeePreference["preference"]>> = {};
  for (const p of prefs) {
    (availability[p.employee_id] ??= {})[p.day_of_week] = p.preference;
  }

  // unavailable dates from approved leave, clipped to this period
  const unavailable: Record<string, Set<string>> = {};
  const periodDates = new Set(datesInRange(period.start_date, period.end_date));
  for (const lv of leaves) {
    const set = (unavailable[lv.employee_id] ??= new Set());
    for (const d of datesInRange(lv.start_date, lv.end_date)) {
      if (periodDates.has(d)) set.add(d);
    }
  }

  const schedulerEmployees: SchedulerEmployee[] = employees.map((e) => ({
    id: e.id,
    full_name: e.full_name,
    target_hours_per_week: e.target_hours_per_week,
    availability: availability[e.id] ?? {},
    unavailableDates: unavailable[e.id] ?? new Set(),
  }));

  const result = generateSchedule({
    startDate: period.start_date,
    endDate: period.end_date,
    shifts: shifts.map((s) => ({
      id: s.id,
      name: s.name,
      start_time: s.start_time,
      end_time: s.end_time,
      required_staff: s.required_staff,
    })),
    employees: schedulerEmployees,
  });

  // Replace any existing assignments for this period.
  await supabase.from("assignments").delete().eq("period_id", period.id);

  const rows = result.assignments.map((a) => ({
    org_id: orgId,
    period_id: period.id,
    shift_type_id: a.shift_type_id,
    employee_id: a.employee_id,
    work_date: a.work_date,
    status: a.employee_id ? "scheduled" : "open",
  }));
  if (rows.length > 0) {
    await supabase.from("assignments").insert(rows);
  }

  return result;
}

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
  const orgId = session.profile!.org_id!;
  const periodId = String(formData.get("period_id") ?? "");
  if (!periodId) return;

  const supabase = await createClient();
  await supabase
    .from("schedule_periods")
    .update({ status: "published" })
    .eq("id", periodId)
    .eq("org_id", orgId);

  revalidatePath(`/manager/schedule/${periodId}`);
  revalidatePath("/manager/schedule");
}

export async function deletePeriod(formData: FormData) {
  const session = await requireManager();
  const orgId = session.profile!.org_id!;
  const periodId = String(formData.get("period_id") ?? "");
  if (!periodId) return;

  const supabase = await createClient();
  await supabase.from("schedule_periods").delete().eq("id", periodId).eq("org_id", orgId);

  revalidatePath("/manager/schedule");
  redirect("/manager/schedule");
}
