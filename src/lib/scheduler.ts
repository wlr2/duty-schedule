// ============================================================================
// Coverage scheduling engine (Phase 3 solver)
// ----------------------------------------------------------------------------
// Guarantees CONTINUOUS CONCURRENT coverage: every position must have its
// required headcount of people on duty across its whole window. People rotate
// with rest, so a post is never left empty even while someone is on break.
//
// The same model serves very different worlds:
//   - Guard duty:  Sentry/PAC/VAC, headcount 1 each, rotate every 2h, 2h rest.
//   - Restaurant:  Dishwasher headcount 5, one continuous 11:00-22:00 shift.
//   - Mixed bands: 2 people 08:00-20:00 plus 1 person overnight (via
//     coverage-requirement bands, which may differ per weekday).
//
// HARD rules (never violated):
//   - One person is in at most one position at any instant (no double-booking).
//   - A person only works a position they're eligible for.
//   - Never scheduled when unavailable (approved leave, day off, DOW-unavailable).
//   - Daily hour cap respected.
//   - Locked assignments are kept and counted toward coverage.
//
// RELAXABLE rules — coverage always wins over comfort. Relaxed in this order
// (least painful first), and every relaxation is recorded for transparency:
//   1. weekly target hours   2. minimum rest   3. max consecutive days
//
// FAIRNESS (soft objectives): least total hours goes first; night and weekend
// duty is spread evenly across eligible people; "preferred" days honoured.
//
// Every unfillable slot yields a GAP with per-person reasons (who was blocked
// and why) — the diagnostic payload the AI assistant turns into plain English.
// ============================================================================

export function timeStrToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minToTimeStr(min: number): string {
  const wrapped = min > 1440 ? min % 1440 : min; // 24:00 stays, past-midnight wraps
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

export type DayPreference = "preferred" | "available" | "unavailable";

/** One headcount demand band. dayOfWeek null = applies every day.
 *  endMin <= startMin means the band crosses midnight. */
export interface RequirementBand {
  dayOfWeek: number | null; // 0 = Sunday
  startMin: number;
  endMin: number;
  minHeadcount: number;
}

export interface EnginePosition {
  id: string;
  name: string;
  color: string;
  startMin: number; // fallback coverage window (used when bands is empty)
  endMin: number;
  headcount: number; // fallback concurrent headcount
  blockMinutes: number; // rotation length; <=0 means one block across the window
  minRestMinutes: number;
  eligible: Set<string> | null; // eligible employee ids; null = everyone
  bands?: RequirementBand[]; // coverage_requirements bands (override window/headcount)
}

export interface EngineEmployee {
  id: string;
  name: string;
  availabilityByDow: Record<number, DayPreference>;
  unavailableDates: Set<string>;
  maxMinutesPerDay: number;
  /** Personal minimum rest between blocks; combined with the position's. */
  minRestMinutes?: number;
  /** Hard-ish limit, relaxed last. null/undefined = no limit. */
  maxConsecutiveDays?: number | null;
  /** Weekly target (soft, relaxed first). null/undefined = no target. */
  maxMinutesPerWeek?: number | null;
  /** Dates on approved leave (kept separate for better diagnostics). */
  leaveDates?: Set<string>;
}

export interface CoverageAssignment {
  date: string;
  positionId: string;
  employeeId: string | null; // null = unfilled gap
  startMin: number;
  endMin: number; // may exceed 1440 for past-midnight blocks
}

export type RelaxedRule = "weekly_hours" | "rest" | "consecutive_days";

export interface Relaxation {
  date: string;
  positionId: string;
  positionName: string;
  employeeId: string;
  employeeName: string;
  rule: RelaxedRule;
  startMin: number;
  endMin: number;
}

export interface GapDetail {
  date: string;
  positionId: string;
  positionName: string;
  startMin: number;
  endMin: number;
  missing: number;
  /** Why each (blocked) person couldn't take the slot. */
  reasons: string[];
}

export interface CoverageResult {
  assignments: CoverageAssignment[];
  gaps: number;
  minutesByEmployee: Record<string, number>;
  gapDetails: GapDetail[];
  relaxations: Relaxation[];
}

interface Slot {
  positionId: string;
  start: number;
  end: number; // may exceed 1440 (crosses midnight)
  headcount: number;
  eligible: Set<string> | null;
  difficulty: number; // lower pool / higher headcount = harder, fill first
}

// TZ-safe calendar-date helpers. NEVER mix local-midnight Date objects with
// toISOString() — east of UTC that shifts every date one day back.
/** dateISO + n days, in pure calendar terms. */
export function addDaysISO(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Weekday (0 = Sunday) of a calendar date, TZ-independent. */
export function dayOfWeekISO(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Today's date on the USER'S calendar (local timezone). */
export function todayISO(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** Inclusive list of ISO dates between start and end. */
export function datesInRange(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  for (let d = startISO; d <= endISO; d = addDaysISO(d, 1)) out.push(d);
  return out;
}

const DAY = 1440;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Monday-based week key, so weekly-hour targets track calendar weeks. */
function weekKey(dateISO: string): string {
  return addDaysISO(dateISO, -((dayOfWeekISO(dateISO) + 6) % 7));
}

/** Night = any overlap with 22:00–06:00 (day-relative minutes). */
function isNightSlot(start: number, end: number): boolean {
  return start < 360 || end > 1320;
}

export function generateCoverageSchedule(input: {
  dates: string[];
  positions: EnginePosition[];
  employees: EngineEmployee[];
  /** Pre-existing kept assignments (locked=true). They occupy people, count
   *  toward coverage, and are NOT re-emitted in the result. */
  locked?: CoverageAssignment[];
}): CoverageResult {
  const { positions, employees } = input;
  const dates = [...input.dates].sort();
  const dateIdx = new Map(dates.map((d, i) => [d, i]));

  const assignments: CoverageAssignment[] = [];
  const gapDetails: GapDetail[] = [];
  const relaxations: Relaxation[] = [];
  let gaps = 0;

  // ---- Per-employee persistent state across the whole horizon --------------
  interface EmpState {
    intervals: { s: number; e: number; pos: string }[]; // absolute minutes
    total: number;
    dayMin: Map<string, number>;
    weekMin: Map<string, number>;
    nightCount: number;
    weekendCount: number;
    workedDates: Set<string>;
  }
  const st: Record<string, EmpState> = {};
  const minutesByEmployee: Record<string, number> = {};
  for (const e of employees) {
    st[e.id] = {
      intervals: [],
      total: 0,
      dayMin: new Map(),
      weekMin: new Map(),
      nightCount: 0,
      weekendCount: 0,
      workedDates: new Set(),
    };
    minutesByEmployee[e.id] = 0;
  }

  const posById = new Map(positions.map((p) => [p.id, p]));

  function occupy(empId: string, date: string, posId: string, startMin: number, endMin: number) {
    const idx = dateIdx.get(date);
    if (idx === undefined || !st[empId]) return;
    const s = idx * DAY + startMin;
    const e = idx * DAY + endMin;
    const len = endMin - startMin;
    const w = weekKey(date);
    const state = st[empId];
    state.intervals.push({ s, e, pos: posId });
    state.total += len;
    state.dayMin.set(date, (state.dayMin.get(date) ?? 0) + len);
    state.weekMin.set(w, (state.weekMin.get(w) ?? 0) + len);
    if (isNightSlot(startMin, endMin)) state.nightCount++;
    const dow = dayOfWeekISO(date);
    if (dow === 0 || dow === 6) state.weekendCount++;
    state.workedDates.add(date);
    minutesByEmployee[empId] = state.total;
  }

  // Locked assignments: occupy people + remember coverage they provide.
  const lockedCover: { pos: string; s: number; e: number }[] = [];
  for (const l of input.locked ?? []) {
    if (!l.employeeId) continue;
    const idx = dateIdx.get(l.date);
    if (idx === undefined) continue;
    const endMin = l.endMin <= l.startMin ? l.endMin + DAY : l.endMin;
    occupy(l.employeeId, l.date, l.positionId, l.startMin, endMin);
    lockedCover.push({ pos: l.positionId, s: idx * DAY + l.startMin, e: idx * DAY + endMin });
  }

  /** Consecutive worked days ending YESTERDAY relative to `date`. */
  function streakBefore(empId: string, date: string, cap: number): number {
    let streak = 0;
    let d = date;
    while (streak < cap + 1) {
      d = addDaysISO(d, -1);
      if (st[empId].workedDates.has(d)) streak++;
      else break;
    }
    return streak;
  }

  // ---- Main loop ------------------------------------------------------------
  for (const date of dates) {
    const idx = dateIdx.get(date)!;
    const dow = dayOfWeekISO(date);
    const isWeekend = dow === 0 || dow === 6;

    // Build today's slots from requirement bands (fallback: position window).
    const slots: Slot[] = [];
    for (const p of positions) {
      const bands: RequirementBand[] =
        p.bands && p.bands.length > 0
          ? p.bands.filter((b) => b.dayOfWeek === null || b.dayOfWeek === dow)
          : [{ dayOfWeek: null, startMin: p.startMin, endMin: p.endMin, minHeadcount: p.headcount }];
      const poolSize = p.eligible ? p.eligible.size : employees.length;
      for (const band of bands) {
        if (band.minHeadcount <= 0) continue;
        const s0 = band.startMin;
        const e0 = band.endMin <= band.startMin ? band.endMin + DAY : band.endMin;
        const block = !p.blockMinutes || p.blockMinutes <= 0 ? e0 - s0 : p.blockMinutes;
        for (let s = s0; s < e0; s += block) {
          const e = Math.min(s + block, e0);
          slots.push({
            positionId: p.id,
            start: s,
            end: e,
            headcount: band.minHeadcount,
            eligible: p.eligible,
            difficulty: poolSize / Math.max(1, band.minHeadcount),
          });
        }
      }
    }

    // Earliest first; within a time, fill the hardest-to-staff slots first.
    slots.sort((a, b) => a.start - b.start || a.difficulty - b.difficulty);

    for (const slot of slots) {
      const p = posById.get(slot.positionId)!;
      const len = slot.end - slot.start;
      const sAbs = idx * DAY + slot.start;
      const eAbs = idx * DAY + slot.end;

      // Locked rows that span this whole slot already provide coverage.
      const preCovered = lockedCover.filter(
        (l) => l.pos === slot.positionId && l.s <= sAbs && l.e >= eAbs,
      ).length;
      const need = slot.headcount - preCovered;
      if (need <= 0) continue;

      // HARD rules, collecting a reason for everyone who is blocked.
      const blockedReasons: string[] = [];
      const usable: EngineEmployee[] = [];
      for (const emp of employees) {
        if (slot.eligible && !slot.eligible.has(emp.id)) {
          blockedReasons.push(`${emp.name}: not eligible for ${p.name}`);
          continue;
        }
        if (emp.leaveDates?.has(date)) {
          blockedReasons.push(`${emp.name}: on approved leave`);
          continue;
        }
        if (emp.unavailableDates.has(date)) {
          blockedReasons.push(`${emp.name}: marked unavailable that day`);
          continue;
        }
        if ((emp.availabilityByDow[dow] ?? "available") === "unavailable") {
          blockedReasons.push(`${emp.name}: not available on ${WEEKDAYS[dow]}s`);
          continue;
        }
        if ((st[emp.id].dayMin.get(date) ?? 0) + len > emp.maxMinutesPerDay) {
          blockedReasons.push(`${emp.name}: would exceed the daily hour cap`);
          continue;
        }
        const overlap = st[emp.id].intervals.find((iv) => sAbs < iv.e && eAbs > iv.s);
        if (overlap) {
          blockedReasons.push(
            `${emp.name}: already on ${posById.get(overlap.pos)?.name ?? "another post"} at that time`,
          );
          continue;
        }
        usable.push(emp);
      }

      // RELAXABLE rules -> tier per candidate (0 = clean ... 3 = worst).
      const tierOf = new Map<string, number>();
      const ruleOf = new Map<string, RelaxedRule>();
      for (const emp of usable) {
        const restReq = Math.max(p.minRestMinutes, emp.minRestMinutes ?? 0);
        const restViol =
          restReq > 0 &&
          st[emp.id].intervals.some(
            (iv) =>
              (iv.e <= sAbs && sAbs - iv.e < restReq) || (iv.s >= eAbs && iv.s - eAbs < restReq),
          );
        const weeklyViol =
          emp.maxMinutesPerWeek != null &&
          emp.maxMinutesPerWeek > 0 &&
          (st[emp.id].weekMin.get(weekKey(date)) ?? 0) + len > emp.maxMinutesPerWeek;
        const consecViol =
          emp.maxConsecutiveDays != null &&
          emp.maxConsecutiveDays > 0 &&
          !st[emp.id].workedDates.has(date) &&
          streakBefore(emp.id, date, emp.maxConsecutiveDays) >= emp.maxConsecutiveDays;

        if (consecViol) {
          tierOf.set(emp.id, 3);
          ruleOf.set(emp.id, "consecutive_days");
        } else if (restViol) {
          tierOf.set(emp.id, 2);
          ruleOf.set(emp.id, "rest");
        } else if (weeklyViol) {
          tierOf.set(emp.id, 1);
          ruleOf.set(emp.id, "weekly_hours");
        } else {
          tierOf.set(emp.id, 0);
        }
      }

      // Fairness ordering. Tier first (avoid relaxing at all if possible),
      // then preferred day, least total hours, least night/weekend load.
      const night = isNightSlot(slot.start, slot.end);
      const continues = (emp: EngineEmployee) =>
        st[emp.id].intervals.some((iv) => iv.pos === slot.positionId && iv.e === sAbs) ? 0 : 1;
      const sorted = [...usable].sort((a, b) => {
        const t = tierOf.get(a.id)! - tierOf.get(b.id)!;
        if (t !== 0) return t;
        if (tierOf.get(a.id)! >= 2) {
          const c = continues(a) - continues(b); // rotation continuity for tired staff
          if (c !== 0) return c;
        }
        const prefA = a.availabilityByDow[dow] === "preferred" ? 0 : 1;
        const prefB = b.availabilityByDow[dow] === "preferred" ? 0 : 1;
        if (prefA !== prefB) return prefA - prefB;
        if (st[a.id].total !== st[b.id].total) return st[a.id].total - st[b.id].total;
        if (night && st[a.id].nightCount !== st[b.id].nightCount)
          return st[a.id].nightCount - st[b.id].nightCount;
        if (isWeekend && st[a.id].weekendCount !== st[b.id].weekendCount)
          return st[a.id].weekendCount - st[b.id].weekendCount;
        return a.name.localeCompare(b.name);
      });

      const chosen = sorted.slice(0, need);
      for (const emp of chosen) {
        const rule = ruleOf.get(emp.id);
        if (rule) {
          relaxations.push({
            date,
            positionId: slot.positionId,
            positionName: p.name,
            employeeId: emp.id,
            employeeName: emp.name,
            rule,
            startMin: slot.start,
            endMin: slot.end,
          });
        }
        assignments.push({
          date,
          positionId: slot.positionId,
          employeeId: emp.id,
          startMin: slot.start,
          endMin: slot.end,
        });
        occupy(emp.id, date, slot.positionId, slot.start, slot.end);
      }

      if (chosen.length < need) {
        const missing = need - chosen.length;
        for (let i = 0; i < missing; i++) {
          assignments.push({
            date,
            positionId: slot.positionId,
            employeeId: null,
            startMin: slot.start,
            endMin: slot.end,
          });
          gaps++;
        }
        gapDetails.push({
          date,
          positionId: slot.positionId,
          positionName: p.name,
          startMin: slot.start,
          endMin: slot.end,
          missing,
          reasons: blockedReasons.slice(0, 10),
        });
      }
    }
  }

  return { assignments, gaps, minutesByEmployee, gapDetails, relaxations };
}
