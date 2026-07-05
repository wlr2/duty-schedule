// ============================================================================
// Coverage scheduling engine
// ----------------------------------------------------------------------------
// Guarantees CONTINUOUS CONCURRENT coverage: every position must have its
// required headcount of people on duty across its whole window. People rotate
// with rest, so a post is never left empty even while someone is on break.
//
// The same model serves very different worlds:
//   - Guard duty:  Sentry/PAC/VAC, headcount 1 each, rotate every 2h, 2h rest.
//   - Restaurant:  Dishwasher headcount 5, one continuous 11:00-22:00 shift.
//
// Hard rules (never violated):
//   - One person is in at most one position at any instant (no double-booking).
//   - A person only works a position they're eligible for.
//   - Never scheduled when unavailable (day off / day-of-week unavailable).
//   - Minimum rest is respected between a person's work blocks.
//   - Daily hour cap respected.
//
// Soft goals: fill every slot (else it's a GAP), honour "preferred" days, and
// spread work fairly (least-worked goes first).
// ============================================================================

export function timeStrToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minToTimeStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

export type DayPreference = "preferred" | "available" | "unavailable";

export interface EnginePosition {
  id: string;
  name: string;
  color: string;
  startMin: number; // coverage window
  endMin: number;
  headcount: number; // how many people on duty at once
  blockMinutes: number; // rotation length; <=0 means one block across the window
  minRestMinutes: number;
  eligible: Set<string> | null; // eligible employee ids; null = everyone
}

export interface EngineEmployee {
  id: string;
  name: string;
  availabilityByDow: Record<number, DayPreference>;
  unavailableDates: Set<string>;
  maxMinutesPerDay: number;
}

export interface CoverageAssignment {
  date: string;
  positionId: string;
  employeeId: string | null; // null = unfilled gap
  startMin: number;
  endMin: number;
}

export interface CoverageResult {
  assignments: CoverageAssignment[];
  gaps: number;
  minutesByEmployee: Record<string, number>;
}

interface Slot {
  positionId: string;
  start: number;
  end: number;
  headcount: number;
  eligible: Set<string> | null;
  difficulty: number; // lower pool / higher headcount = harder, fill first
}

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

export function generateCoverageSchedule(input: {
  dates: string[];
  positions: EnginePosition[];
  employees: EngineEmployee[];
}): CoverageResult {
  const { dates, positions, employees } = input;
  const posById = new Map(positions.map((p) => [p.id, p]));

  const assignments: CoverageAssignment[] = [];
  let gaps = 0;
  const minutesByEmployee: Record<string, number> = {};
  for (const e of employees) minutesByEmployee[e.id] = 0;

  for (const date of dates) {
    const dow = new Date(date + "T00:00:00").getDay();

    // Per-day per-employee state.
    const intervals: Record<string, { s: number; e: number; pos: string }[]> = {};
    const dayMinutes: Record<string, number> = {};
    for (const e of employees) {
      intervals[e.id] = [];
      dayMinutes[e.id] = 0;
    }

    // Tile every position's window into rotation blocks -> slots to fill.
    const slots: Slot[] = [];
    for (const p of positions) {
      const block =
        !p.blockMinutes || p.blockMinutes <= 0 ? p.endMin - p.startMin : p.blockMinutes;
      const poolSize = p.eligible ? p.eligible.size : employees.length;
      for (let s = p.startMin; s < p.endMin; s += block) {
        const e = Math.min(s + block, p.endMin);
        slots.push({
          positionId: p.id,
          start: s,
          end: e,
          headcount: p.headcount,
          eligible: p.eligible,
          difficulty: poolSize / Math.max(1, p.headcount),
        });
      }
    }

    // Earliest first; within a time, fill the hardest-to-staff slots first.
    slots.sort((a, b) => a.start - b.start || a.difficulty - b.difficulty);

    for (const slot of slots) {
      const p = posById.get(slot.positionId)!;
      const len = slot.end - slot.start;

      // HARD rules: eligible, available, not double-booked, under daily cap.
      const base = employees.filter((emp) => {
        if (slot.eligible && !slot.eligible.has(emp.id)) return false;
        if (emp.unavailableDates.has(date)) return false;
        if ((emp.availabilityByDow[dow] ?? "available") === "unavailable") return false;
        if (dayMinutes[emp.id] + len > emp.maxMinutesPerDay) return false;
        for (const iv of intervals[emp.id]) {
          if (slot.start < iv.e && slot.end > iv.s) return false; // overlap (hard)
        }
        return true;
      });

      // Rest is a SOFT preference: prefer rested people, but use a tired person
      // rather than leave the post empty. Coverage always wins over rest.
      const restOk = (emp: EngineEmployee) => {
        for (const iv of intervals[emp.id]) {
          if (iv.s >= slot.end && iv.s - slot.end < p.minRestMinutes) return false;
          if (iv.e <= slot.start && slot.start - iv.e < p.minRestMinutes) return false;
        }
        return true;
      };
      const preferred = (emp: EngineEmployee) =>
        emp.availabilityByDow[dow] === "preferred" ? 0 : 1;
      // Did they just finish this same position? Keep them on for continuity.
      const continues = (emp: EngineEmployee) =>
        intervals[emp.id].some((iv) => iv.pos === slot.positionId && iv.e === slot.start)
          ? 0
          : 1;

      const rested = base
        .filter(restOk)
        .sort(
          (a, b) =>
            preferred(a) - preferred(b) || minutesByEmployee[a.id] - minutesByEmployee[b.id],
        );
      const tired = base
        .filter((e) => !restOk(e))
        .sort(
          (a, b) =>
            continues(a) - continues(b) || minutesByEmployee[a.id] - minutesByEmployee[b.id],
        );

      const chosen = [...rested, ...tired].slice(0, slot.headcount);
      for (const emp of chosen) {
        assignments.push({
          date,
          positionId: slot.positionId,
          employeeId: emp.id,
          startMin: slot.start,
          endMin: slot.end,
        });
        intervals[emp.id].push({ s: slot.start, e: slot.end, pos: slot.positionId });
        dayMinutes[emp.id] += len;
        minutesByEmployee[emp.id] += len;
      }

      for (let i = chosen.length; i < slot.headcount; i++) {
        assignments.push({
          date,
          positionId: slot.positionId,
          employeeId: null,
          startMin: slot.start,
          endMin: slot.end,
        });
        gaps++;
      }
    }
  }

  return { assignments, gaps, minutesByEmployee };
}
