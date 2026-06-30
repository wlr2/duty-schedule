// ============================================================================
// Scheduling engine
// ----------------------------------------------------------------------------
// A deterministic, fair roster generator. It GUARANTEES the hard rules and
// optimizes the soft goals with a greedy, balance-aware heuristic:
//
//   Hard rules (never violated):
//     - An employee works at most one shift per day.
//     - An employee is never scheduled on a day they marked "unavailable".
//     - An employee is never scheduled while on approved leave/MC.
//
//   Soft goals (optimized, best-effort):
//     - Fill every shift's required staff count (leaves the slot OPEN if it
//       genuinely can't be filled, rather than breaking a hard rule).
//     - Move each person toward their weekly target hours.
//     - Prefer days the employee marked "preferred".
//     - Spread work fairly (whoever is furthest below their target goes first).
//
// This is intentionally a transparent heuristic (not a black box). It can be
// swapped for a constraint solver (e.g. OR-Tools) later without changing callers.
// ============================================================================

import { shiftHours } from "./format";
import type { PreferenceLevel } from "./types";

export interface SchedulerShift {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  required_staff: number;
}

export interface SchedulerEmployee {
  id: string;
  full_name: string | null;
  target_hours_per_week: number;
  /** day_of_week (0=Sun) -> preference. Missing day defaults to "available". */
  availability: Record<number, PreferenceLevel>;
  /** ISO dates (YYYY-MM-DD) the employee cannot work (approved leave/MC). */
  unavailableDates: Set<string>;
}

export interface PlannedAssignment {
  work_date: string; // YYYY-MM-DD
  shift_type_id: string;
  employee_id: string | null; // null = couldn't be filled (open slot)
}

export interface ScheduleResult {
  assignments: PlannedAssignment[];
  /** Per-employee scheduled hours, for display/validation. */
  hoursByEmployee: Record<string, number>;
  openSlots: number;
}

const PREF_WEIGHT: Record<PreferenceLevel, number> = {
  preferred: 2,
  available: 1,
  unavailable: -1, // hard-excluded before scoring, but defined for completeness
};

/** Inclusive list of ISO dates between start and end. */
export function datesInRange(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const d = new Date(startISO + "T00:00:00");
  const end = new Date(endISO + "T00:00:00");
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function generateSchedule(input: {
  startDate: string;
  endDate: string;
  shifts: SchedulerShift[];
  employees: SchedulerEmployee[];
}): ScheduleResult {
  const { startDate, endDate, shifts, employees } = input;
  const dates = datesInRange(startDate, endDate);
  const periodDays = dates.length || 1;

  // Convert weekly targets into a target for this whole period.
  const targetHours: Record<string, number> = {};
  const scheduledHours: Record<string, number> = {};
  for (const e of employees) {
    targetHours[e.id] = (e.target_hours_per_week * periodDays) / 7;
    scheduledHours[e.id] = 0;
  }

  // Track who is already working on a given date (one shift per day).
  const workingOn: Record<string, Set<string>> = {};
  for (const date of dates) workingOn[date] = new Set();

  const assignments: PlannedAssignment[] = [];
  let openSlots = 0;

  for (const date of dates) {
    const dow = new Date(date + "T00:00:00").getDay();

    for (const shift of shifts) {
      const length = shiftHours(shift.start_time, shift.end_time);

      for (let slot = 0; slot < shift.required_staff; slot++) {
        const candidate = pickBest({
          date,
          dow,
          length,
          employees,
          workingOn,
          scheduledHours,
          targetHours,
        });

        if (candidate) {
          assignments.push({
            work_date: date,
            shift_type_id: shift.id,
            employee_id: candidate.id,
          });
          workingOn[date].add(candidate.id);
          scheduledHours[candidate.id] += length;
        } else {
          assignments.push({
            work_date: date,
            shift_type_id: shift.id,
            employee_id: null,
          });
          openSlots++;
        }
      }
    }
  }

  return { assignments, hoursByEmployee: scheduledHours, openSlots };
}

function pickBest(ctx: {
  date: string;
  dow: number;
  length: number;
  employees: SchedulerEmployee[];
  workingOn: Record<string, Set<string>>;
  scheduledHours: Record<string, number>;
  targetHours: Record<string, number>;
}): SchedulerEmployee | null {
  const { date, dow, length, employees, workingOn, scheduledHours, targetHours } = ctx;

  let best: SchedulerEmployee | null = null;
  let bestScore = -Infinity;

  for (const e of employees) {
    // ---- Hard rules ----
    if (workingOn[date].has(e.id)) continue; // already working today
    if (e.unavailableDates.has(date)) continue; // on leave/MC
    const pref = e.availability[dow] ?? "available";
    if (pref === "unavailable") continue; // marked unavailable

    // ---- Soft scoring ----
    const remaining = targetHours[e.id] - scheduledHours[e.id];
    // Heavily penalize going far over target so hours stay near goal.
    const overage = scheduledHours[e.id] + length - targetHours[e.id];
    const overPenalty = overage > 0 ? overage * 1.5 : 0;

    const score =
      remaining + // furthest-below-target goes first (fairness + hit targets)
      PREF_WEIGHT[pref] * 3 - // honor preferred days
      overPenalty;

    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }

  return best;
}
