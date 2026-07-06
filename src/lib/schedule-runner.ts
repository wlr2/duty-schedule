// Shared schedule generator: loads positions, requirement bands, eligibility,
// availability, approved leave and locked assignments, runs the solver, then
// (re)writes the period's assignments (locked rows survive untouched).
// Used by the manual "Generate" button and the AI assistant.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  datesInRange,
  minToTimeStr,
  timeStrToMin,
  type CoverageAssignment,
  type DayPreference,
  type EngineEmployee,
  type EnginePosition,
  type RequirementBand,
} from "@/lib/scheduler";
import { defaultSolver } from "@/lib/solver";
import { detectGaps } from "@/lib/gap-detector";
import type {
  AvailabilityException,
  CoverageRequirement,
  EmployeePreference,
  LeaveRequest,
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
  const [posRes, empRes, prefsRes, memRes, exRes, reqRes, leaveRes, lockedRes] =
    await Promise.all([
      supabase.from("shift_types").select("*").eq("org_id", orgId).order("start_time"),
      supabase
        .from("profiles")
        .select("id, full_name, target_hours_per_week, min_rest_hours, max_consecutive_days")
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
      supabase
        .from("coverage_requirements")
        .select("position_id, day_of_week, start_time, end_time, min_headcount")
        .eq("org_id", orgId),
      supabase
        .from("leave_requests")
        .select("employee_id, start_date, end_date")
        .eq("org_id", orgId)
        .eq("status", "approved")
        .lte("start_date", period.end_date)
        .gte("end_date", period.start_date),
      supabase
        .from("assignments")
        .select("shift_type_id, employee_id, work_date, start_time, end_time")
        .eq("period_id", period.id)
        .eq("locked", true)
        .not("employee_id", "is", null),
    ]);

  const shiftTypes = (posRes.data ?? []) as ShiftType[];
  const staff = (empRes.data ?? []) as Pick<
    Profile,
    "id" | "full_name" | "target_hours_per_week" | "min_rest_hours" | "max_consecutive_days"
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
  const reqRows = (reqRes.data ?? []) as Pick<
    CoverageRequirement,
    "position_id" | "day_of_week" | "start_time" | "end_time" | "min_headcount"
  >[];
  const leaveRows = (leaveRes.data ?? []) as Pick<
    LeaveRequest,
    "employee_id" | "start_date" | "end_date"
  >[];
  const lockedRows = (lockedRes.data ?? []) as {
    shift_type_id: string | null;
    employee_id: string;
    work_date: string;
    start_time: string | null;
    end_time: string | null;
  }[];

  const bandsByPos: Record<string, RequirementBand[]> = {};
  for (const r of reqRows) {
    (bandsByPos[r.position_id] ??= []).push({
      dayOfWeek: r.day_of_week,
      startMin: timeStrToMin(r.start_time),
      endMin: timeStrToMin(r.end_time),
      minHeadcount: r.min_headcount,
    });
  }

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
      bands: bandsByPos[p.id] ?? [],
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
  // Approved leave -> per-employee leave dates clipped to the period.
  const leaveByEmp: Record<string, Set<string>> = {};
  for (const lv of leaveRows) {
    const from = lv.start_date < period.start_date ? period.start_date : lv.start_date;
    const to = lv.end_date > period.end_date ? period.end_date : lv.end_date;
    for (const d of datesInRange(from, to)) {
      (leaveByEmp[lv.employee_id] ??= new Set()).add(d);
    }
  }

  const employees: EngineEmployee[] = staff.map((e) => ({
    id: e.id,
    name: e.full_name ?? "",
    availabilityByDow: availByEmp[e.id] ?? {},
    unavailableDates: unavailByEmp[e.id] ?? new Set(),
    maxMinutesPerDay: 16 * 60,
    minRestMinutes: (e.min_rest_hours ?? 0) * 60,
    maxConsecutiveDays: e.max_consecutive_days,
    maxMinutesPerWeek:
      e.target_hours_per_week && e.target_hours_per_week > 0
        ? e.target_hours_per_week * 60
        : null,
    leaveDates: leaveByEmp[e.id] ?? new Set(),
  }));

  const posTimeById = new Map(shiftTypes.map((p) => [p.id, p]));
  const locked: CoverageAssignment[] = lockedRows
    .filter((l) => l.shift_type_id)
    .map((l) => {
      const fallback = posTimeById.get(l.shift_type_id!);
      return {
        date: l.work_date,
        positionId: l.shift_type_id!,
        employeeId: l.employee_id,
        startMin: timeStrToMin(l.start_time ?? fallback?.start_time ?? "00:00"),
        endMin: timeStrToMin(l.end_time ?? fallback?.end_time ?? "00:00"),
      };
    });

  const result = await defaultSolver.solve({
    dates: datesInRange(period.start_date, period.end_date),
    positions,
    employees,
    locked,
  });

  // Locked rows survive; everything else is regenerated.
  await supabase.from("assignments").delete().eq("period_id", period.id).eq("locked", false);

  const rows = result.assignments.map((a) => ({
    org_id: orgId,
    period_id: period.id,
    shift_type_id: a.positionId,
    employee_id: a.employeeId,
    work_date: a.date,
    start_time: minToTimeStr(a.startMin),
    end_time: minToTimeStr(a.endMin),
    status: a.employeeId ? "scheduled" : "open",
    source: "solver",
  }));
  if (rows.length > 0) await supabase.from("assignments").insert(rows);

  // Post-solve gap sweep: log coverage_gaps + alert managers (deduped).
  try {
    await detectGaps(supabase, orgId, period.start_date, period.end_date);
  } catch (err) {
    console.error("Gap detection failed (non-fatal):", err);
  }

  return result;
}
