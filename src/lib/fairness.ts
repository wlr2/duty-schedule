// ============================================================================
// Fairness score — burden distribution over a period's stored assignments.
// Night/weekend minutes weigh more; score = (1 − Gini) × 100.
// Reads STORED assignments (manual, locked and claimed rows all count).
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysISO, dayOfWeekISO, datesInRange, timeStrToMin } from "@/lib/scheduler";

export const NIGHT_BONUS = 0.5; // 22:00–06:00 overlap
export const WEEKEND_BONUS = 0.5; // Sat/Sun (segment's effective date)

export interface PersonBurden {
  employeeId: string;
  name: string;
  totalMinutes: number; // unweighted
  nightMinutes: number;
  weekendMinutes: number;
  burden: number; // weighted minutes (the Gini input)
  sharePct: number; // burden / Σ burden × 100, 1 dp
}

export interface FairnessSnapshot {
  score: number | null; // 0–100, null when undefined
  gini: number | null;
  people: PersonBurden[]; // sorted by burden desc
  computedAt: string; // ISO timestamp
  nightBonus: number; // constants captured for reproducibility
  weekendBonus: number;
}

export interface AssignmentLike {
  employee_id: string | null;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  status?: string;
  shift_types: { start_time: string; end_time: string } | null;
}

const DAY = 1440;
const NIGHT_END = 360; // 06:00
const NIGHT_START = 1320; // 22:00

/** Minutes of [s,e) (day-relative, 0..1440) overlapping 22:00–06:00. */
function nightOverlap(s: number, e: number): number {
  const early = Math.max(0, Math.min(e, NIGHT_END) - Math.max(s, 0));
  const late = Math.max(0, Math.min(e, DAY) - Math.max(s, NIGHT_START));
  return early + late;
}

/** Aggregate weighted burden per person. Splits past-midnight blocks at the
 *  day boundary so their tail books to the NEXT calendar date (weekends). */
export function computeBurdens(
  rows: AssignmentLike[],
  names: Map<string, string>,
  includedIds: Set<string>,
): PersonBurden[] {
  const acc = new Map<string, { total: number; night: number; weekend: number; burden: number }>();
  for (const id of includedIds) acc.set(id, { total: 0, night: 0, weekend: 0, burden: 0 });

  for (const a of rows) {
    if (!a.employee_id || !includedIds.has(a.employee_id)) continue;
    if (a.status === "open") continue;
    const s = timeStrToMin(a.start_time ?? a.shift_types?.start_time ?? "00:00");
    let e = timeStrToMin(a.end_time ?? a.shift_types?.end_time ?? "00:00");
    if (e <= s) e += DAY;
    if (e <= s) continue;

    // Segments: [s, min(e,1440)) on work_date; overflow on the next date.
    const segments: { date: string; s: number; e: number }[] = [
      { date: a.work_date, s, e: Math.min(e, DAY) },
    ];
    if (e > DAY) segments.push({ date: addDaysISO(a.work_date, 1), s: 0, e: e - DAY });

    const bucket = acc.get(a.employee_id)!;
    for (const seg of segments) {
      const len = seg.e - seg.s;
      if (len <= 0) continue;
      const night = nightOverlap(seg.s, seg.e);
      const dow = dayOfWeekISO(seg.date);
      const weekend = dow === 0 || dow === 6;
      bucket.total += len;
      bucket.night += night;
      if (weekend) bucket.weekend += len;
      bucket.burden += len + NIGHT_BONUS * night + (weekend ? WEEKEND_BONUS * len : 0);
    }
  }

  const totalBurden = [...acc.values()].reduce((s2, b) => s2 + b.burden, 0);
  return [...acc.entries()]
    .map(([employeeId, b]) => ({
      employeeId,
      name: names.get(employeeId) ?? "Unnamed",
      totalMinutes: Math.round(b.total),
      nightMinutes: Math.round(b.night),
      weekendMinutes: Math.round(b.weekend),
      burden: Math.round(b.burden * 10) / 10,
      sharePct: totalBurden > 0 ? Math.round((1000 * b.burden) / totalBurden) / 10 : 0,
    }))
    .sort((a, b) => b.burden - a.burden);
}

/** Population Gini coefficient; null when undefined (n ≤ 1 or all zero). */
export function gini(values: number[]): number | null {
  const n = values.length;
  if (n <= 1) return null;
  const sum = values.reduce((s, v) => s + v, 0);
  if (sum <= 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  let weighted = 0;
  for (let i = 1; i <= n; i++) weighted += (2 * i - n - 1) * sorted[i - 1];
  return weighted / (n * sum);
}

/** 0–100 evenness score. The population Gini maxes out at (n−1)/n, so it is
 *  normalised by n/(n−1): with 2 people, one taking everything scores 0
 *  (acceptance 2.6.1), not 50. */
export function fairnessScore(values: number[]): number | null {
  const g = gini(values);
  if (g === null) return null;
  const n = values.length;
  const normalized = Math.min(1, Math.max(0, (g * n) / (n - 1)));
  return Math.round((1 - normalized) * 100);
}

/** Compute the snapshot for a period; null when it has no assignments. */
export async function computeFairnessForPeriod(
  supabase: SupabaseClient,
  orgId: string,
  periodId: string,
): Promise<FairnessSnapshot | null> {
  const { data: period } = await supabase
    .from("schedule_periods")
    .select("start_date, end_date")
    .eq("id", periodId)
    .eq("org_id", orgId)
    .single();
  if (!period) return null;

  const [{ data: rowsData }, { data: staffData }, { data: leaveData }] = await Promise.all([
    supabase
      .from("assignments")
      .select("employee_id, work_date, start_time, end_time, status, shift_types(start_time, end_time)")
      .eq("period_id", periodId)
      .eq("org_id", orgId),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", orgId)
      .eq("role", "employee"),
    supabase
      .from("leave_requests")
      .select("employee_id, start_date, end_date")
      .eq("org_id", orgId)
      .eq("status", "approved")
      .lte("start_date", period.end_date)
      .gte("end_date", period.start_date),
  ]);

  const rows = (rowsData ?? []) as unknown as AssignmentLike[];
  if (rows.filter((r) => r.employee_id && r.status !== "open").length === 0) return null;

  const staff = (staffData ?? []) as { id: string; full_name: string | null }[];
  const names = new Map(staff.map((s) => [s.id, s.full_name ?? "Unnamed"]));

  // Exclude anyone whose approved leave covers EVERY date of the period.
  const dates = datesInRange(period.start_date, period.end_date);
  const leaveDates = new Map<string, Set<string>>();
  for (const lv of (leaveData ?? []) as { employee_id: string; start_date: string; end_date: string }[]) {
    const from = lv.start_date < period.start_date ? period.start_date : lv.start_date;
    const to = lv.end_date > period.end_date ? period.end_date : lv.end_date;
    const set = leaveDates.get(lv.employee_id) ?? new Set<string>();
    for (const d of datesInRange(from, to)) set.add(d);
    leaveDates.set(lv.employee_id, set);
  }
  const includedIds = new Set(
    staff
      .filter((s) => {
        const covered = leaveDates.get(s.id);
        return !(covered && dates.every((d) => covered.has(d)));
      })
      .map((s) => s.id),
  );

  const people = computeBurdens(rows, names, includedIds);
  const burdens = people.map((p) => p.burden);
  return {
    score: fairnessScore(burdens),
    gini: gini(burdens),
    people,
    computedAt: new Date().toISOString(),
    nightBonus: NIGHT_BONUS,
    weekendBonus: WEEKEND_BONUS,
  };
}

/** Compute + persist onto schedule_periods. Never throws (migration 12 may
 *  not be run yet); failures just log. */
export async function storeFairnessForPeriod(
  supabase: SupabaseClient,
  orgId: string,
  periodId: string,
): Promise<void> {
  try {
    const snapshot = await computeFairnessForPeriod(supabase, orgId, periodId);
    if (!snapshot) return;
    const { error } = await supabase
      .from("schedule_periods")
      .update({ fairness: snapshot, fairness_score: snapshot.score })
      .eq("id", periodId)
      .eq("org_id", orgId);
    if (error) console.error("Fairness store failed (non-fatal):", error.message);
  } catch (err) {
    console.error("Fairness compute failed (non-fatal):", err);
  }
}
