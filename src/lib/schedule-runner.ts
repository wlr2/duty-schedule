// Shared schedule generator: loads positions, eligibility, availability and
// runs the coverage engine, then (re)writes assignments for a period.
// Used by the manual "Generate" button and the AI assistant.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  datesInRange,
  generateCoverageSchedule,
  minToTimeStr,
  timeStrToMin,
  type DayPreference,
  type EngineEmployee,
  type EnginePosition,
} from "@/lib/scheduler";
import type {
  AvailabilityException,
  EmployeePreference,
  PositionMember,
  Profile,
  ShiftType,
} from "@/lib/types";

export interface PeriodLite {
  id: string;
  start_date: string;
  end_date: string;
}

export async function generateForPeriod(
  supabase: SupabaseClient,
  orgId: string,
  period: PeriodLite,
) {
  const [posRes, empRes, prefsRes, memRes, exRes] = await Promise.all([
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
    supabase.from("position_members").select("position_id, employee_id").eq("org_id", orgId),
    supabase
      .from("availability_exceptions")
      .select("employee_id, work_date")
      .eq("org_id", orgId)
      .gte("work_date", period.start_date)
      .lte("work_date", period.end_date),
  ]);

  const shiftTypes = (posRes.data ?? []) as ShiftType[];
  const staff = (empRes.data ?? []) as Pick<
    Profile,
    "id" | "full_name" | "target_hours_per_week"
  >[];
  const prefs = (prefsRes.data ?? []) as Pick<
    EmployeePreference,
    "employee_id" | "day_of_week" | "preference"
  >[];
  const members = (memRes.data ?? []) as Pick<
    PositionMember,
    "position_id" | "employee_id"
  >[];
  const exceptions = (exRes.data ?? []) as Pick<
    AvailabilityException,
    "employee_id" | "work_date"
  >[];

  const positions: EnginePosition[] = shiftTypes.map((p) => {
    const eligibleIds = members.filter((m) => m.position_id === p.id).map((m) => m.employee_id);
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      startMin: timeStrToMin(p.start_time),
      endMin: timeStrToMin(p.end_time),
      headcount: p.required_staff ?? 1,
      blockMinutes: p.block_minutes ?? 0,
      minRestMinutes: p.min_rest_minutes ?? 0,
      eligible: eligibleIds.length > 0 ? new Set(eligibleIds) : null,
    };
  });

  const availByEmp: Record<string, Record<number, DayPreference>> = {};
  for (const pr of prefs) {
    (availByEmp[pr.employee_id] ??= {})[pr.day_of_week] = pr.preference;
  }
  const unavailByEmp: Record<string, Set<string>> = {};
  for (const ex of exceptions) {
    (unavailByEmp[ex.employee_id] ??= new Set()).add(ex.work_date);
  }

  const employees: EngineEmployee[] = staff.map((e) => ({
    id: e.id,
    name: e.full_name ?? "",
    availabilityByDow: availByEmp[e.id] ?? {},
    unavailableDates: unavailByEmp[e.id] ?? new Set(),
    maxMinutesPerDay: 16 * 60,
  }));

  const result = generateCoverageSchedule({
    dates: datesInRange(period.start_date, period.end_date),
    positions,
    employees,
  });

  await supabase.from("assignments").delete().eq("period_id", period.id);

  const rows = result.assignments.map((a) => ({
    org_id: orgId,
    period_id: period.id,
    shift_type_id: a.positionId,
    employee_id: a.employeeId,
    work_date: a.date,
    start_time: minToTimeStr(a.startMin),
    end_time: minToTimeStr(a.endMin),
    status: a.employeeId ? "scheduled" : "open",
  }));
  if (rows.length > 0) await supabase.from("assignments").insert(rows);

  return result;
}
