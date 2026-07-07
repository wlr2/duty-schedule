// ============================================================================
// Roster stress test — absence-shock simulation (read-only).
// ----------------------------------------------------------------------------
// Re-runs the solver in memory with injected absences to measure how much
// coverage breaks and where. NEVER writes: no assignments, no coverage_gaps,
// no notifications. Mirrors repair.ts's lock-then-fill realism.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultSolver } from "@/lib/solver";
import {
  loadSolverInput,
  rowsToEngineAssignments,
  type PeriodLite,
} from "@/lib/schedule-runner";
import {
  datesInRange,
  dayOfWeekISO,
  timeStrToMin,
  type CoverageAssignment,
  type EngineEmployee,
  type GapDetail,
} from "@/lib/scheduler";

export interface StressScenario {
  /** Employee ids simulated absent. 1 for sweep rows, 2+ for pair/custom. */
  absentIds: string[];
  /** Absence window (inclusive ISO dates). Defaults to the whole period. */
  fromDate: string;
  toDate: string;
}

export interface BrokenSlice {
  date: string;
  positionId: string;
  positionName: string;
  startMin: number;
  endMin: number; // may exceed 1440 (past midnight)
  missing: number; // headcount short
  reasons: string[]; // per-person block reasons from GapDetail
}

export interface ScenarioResult {
  absentIds: string[];
  absentNames: string[];
  /** Gap minutes CAUSED by this absence (scenario − baseline, floored at 0). */
  deltaGapMinutes: number;
  rawGapMinutes: number;
  brokenSlices: BrokenSlice[];
  positionsBroken: string[]; // distinct position names
  firstBreakDate: string | null;
  /** Relaxations the repair had to take to absorb the absence. */
  relaxationsIncurred: number;
  /** True when deltaGapMinutes === 0: the team fully absorbs this absence. */
  absorbed: boolean;
}

export interface StressReport {
  periodId: string;
  baselineGapMinutes: number;
  scenarios: ScenarioResult[]; // sorted by deltaGapMinutes desc
  /** % of scenarios fully absorbed (0 delta) — the roster's resilience. */
  resilienceScore: number; // 0–100, rounded
  requiredMinutes: number; // Σ requirement-band demand over the window (context)
  truncated: boolean; // true if the caps trimmed the sweep
}

export const MAX_SCENARIOS = 30;
export const MAX_DAYS = 31;

export function gapMinutes(gaps: GapDetail[]): number {
  return gaps.reduce((sum, g) => sum + g.missing * (g.endMin - g.startMin), 0);
}

/** Deep-clone employees for one scenario run and inject the absence.
 *  CRITICAL: EngineEmployee holds Sets (unavailableDates, leaveDates) — these
 *  are references into the shared bundle. Clone them per run or every
 *  scenario after the first is corrupted. */
function withAbsence(
  employees: EngineEmployee[],
  absentIds: Set<string>,
  dates: string[],
): EngineEmployee[] {
  return employees.map((e) => {
    const clone: EngineEmployee = {
      ...e,
      availabilityByDow: { ...e.availabilityByDow },
      unavailableDates: new Set(e.unavailableDates),
      leaveDates: new Set(e.leaveDates ?? []),
    };
    if (absentIds.has(e.id)) {
      for (const d of dates) clone.unavailableDates.add(d);
    }
    return clone;
  });
}

interface StoredRow {
  shift_type_id: string | null;
  employee_id: string | null;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
}

export async function runStressSweep(
  supabase: SupabaseClient,
  orgId: string,
  period: PeriodLite,
  opts?: { scenarios?: StressScenario[] },
): Promise<StressReport> {
  // 1. Solver input + current assignments — each fetched ONCE.
  const input = await loadSolverInput(supabase, orgId, period);
  const { data: rowData } = await supabase
    .from("assignments")
    .select("shift_type_id, employee_id, work_date, start_time, end_time")
    .eq("period_id", period.id)
    .not("employee_id", "is", null)
    .neq("status", "open");
  const storedRows = (rowData ?? []) as StoredRow[];
  const nameOf = new Map(input.employees.map((e) => [e.id, e.name]));

  // 2. Scenario list: explicit, or a one-person sweep across all employees.
  let truncated = false;
  let scenarios: StressScenario[];
  if (opts?.scenarios && opts.scenarios.length > 0) {
    scenarios = opts.scenarios.slice(0, MAX_SCENARIOS);
    truncated = opts.scenarios.length > MAX_SCENARIOS;
  } else {
    let ids = input.employees.map((e) => e.id);
    if (ids.length > MAX_SCENARIOS) {
      // Sweep the 30 most-scheduled people; the rest barely move coverage.
      const minutesById = new Map<string, number>();
      for (const r of storedRows) {
        if (!r.employee_id) continue;
        const s = timeStrToMin(r.start_time ?? "00:00");
        let e = timeStrToMin(r.end_time ?? "00:00");
        if (e <= s) e += 1440;
        minutesById.set(r.employee_id, (minutesById.get(r.employee_id) ?? 0) + (e - s));
      }
      ids = [...ids].sort((a, b) => (minutesById.get(b) ?? 0) - (minutesById.get(a) ?? 0));
      ids = ids.slice(0, MAX_SCENARIOS);
      truncated = true;
    }
    scenarios = ids.map((id) => ({
      absentIds: [id],
      fromDate: period.start_date,
      toDate: period.end_date,
    }));
  }
  // Clamp windows to the period and the day cap.
  scenarios = scenarios.map((s) => {
    let from = s.fromDate < period.start_date ? period.start_date : s.fromDate;
    let to = s.toDate > period.end_date ? period.end_date : s.toDate;
    if (to < from) [from, to] = [to, from];
    if (datesInRange(from, to).length > MAX_DAYS) {
      truncated = true;
      to = datesInRange(from, to)[MAX_DAYS - 1];
    }
    return { ...s, fromDate: from, toDate: to };
  });

  const toEngine = (rows: StoredRow[]): CoverageAssignment[] =>
    rowsToEngineAssignments(rows, input.posTimeById);

  // 3. Baseline: everything locked, nobody absent.
  const baseline = await defaultSolver.solve({
    dates: input.dates,
    positions: input.positions,
    employees: withAbsence(input.employees, new Set(), []), // fresh Sets
    locked: toEngine(storedRows),
  });
  const baselineGapMinutes = gapMinutes(baseline.gapDetails);

  // 4. Scenarios, sequentially (the greedy solver is sub-second at this scale).
  const results: ScenarioResult[] = [];
  for (const sc of scenarios) {
    const absentSet = new Set(sc.absentIds);
    const scenarioDates = datesInRange(sc.fromDate, sc.toDate);
    // The absentees' rows vanish (including locked ones) — that's the point.
    const locked = toEngine(storedRows.filter((r) => !absentSet.has(r.employee_id ?? "")));
    const employees = withAbsence(input.employees, absentSet, scenarioDates);

    const run = await defaultSolver.solve({
      dates: input.dates,
      positions: input.positions,
      employees,
      locked,
    });

    const raw = gapMinutes(run.gapDetails);
    const delta = Math.max(0, raw - baselineGapMinutes);
    const brokenSlices: BrokenSlice[] = run.gapDetails.map((g) => ({
      date: g.date,
      positionId: g.positionId,
      positionName: g.positionName,
      startMin: g.startMin,
      endMin: g.endMin,
      missing: g.missing,
      reasons: g.reasons,
    }));
    results.push({
      absentIds: sc.absentIds,
      absentNames: sc.absentIds.map((id) => nameOf.get(id) ?? "Unknown"),
      deltaGapMinutes: delta,
      rawGapMinutes: raw,
      brokenSlices,
      positionsBroken: [...new Set(brokenSlices.map((b) => b.positionName))],
      firstBreakDate: brokenSlices.length > 0 ? brokenSlices[0].date : null,
      relaxationsIncurred: run.relaxations.length,
      absorbed: delta === 0,
    });
  }
  results.sort((a, b) => b.deltaGapMinutes - a.deltaGapMinutes);

  // 5. Context: total demanded minutes over the period.
  let requiredMinutes = 0;
  for (const date of input.dates) {
    const dow = dayOfWeekISO(date);
    for (const p of input.positions) {
      const bands =
        p.bands && p.bands.length > 0
          ? p.bands.filter((b) => b.dayOfWeek === null || b.dayOfWeek === dow)
          : [{ startMin: p.startMin, endMin: p.endMin, minHeadcount: p.headcount }];
      for (const b of bands) {
        const e = b.endMin <= b.startMin ? b.endMin + 1440 : b.endMin;
        requiredMinutes += (e - b.startMin) * b.minHeadcount;
      }
    }
  }

  return {
    periodId: period.id,
    baselineGapMinutes,
    scenarios: results,
    resilienceScore:
      results.length > 0
        ? Math.round((100 * results.filter((r) => r.absorbed).length) / results.length)
        : 100,
    requiredMinutes,
    truncated,
  };
}
