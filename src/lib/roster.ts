// Pure helpers that turn a flat list of duties into the timeline-matrix rows
// (people x hourly columns, color-coded duty bands, total hours, off rows).
// Kept free of React/DB so it can be unit-tested directly.

import { hourLabel } from "./format";

export interface RosterDuty {
  employeeId: string;
  date: string; // YYYY-MM-DD
  startH: number; // e.g. 8 or 8.5
  endH: number;
  label: string;
  color: string;
}

export interface RosterPerson {
  id: string;
  name: string;
}

export interface RosterCell {
  label: string | null; // duty name, or null for an empty hour
  color: string | null;
  showLabel: boolean; // only the first hour of a band shows the text
}

export interface RosterRow {
  id: string;
  name: string;
  totalHours: number;
  off: boolean;
  cells: RosterCell[]; // one per hour column
}

/** Integer hour columns [minStart, maxEnd) across all duties. */
export function rosterHourColumns(
  duties: Pick<RosterDuty, "startH" | "endH">[],
  fallback = { start: 8, end: 18 },
): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const d of duties) {
    min = Math.min(min, d.startH);
    max = Math.max(max, d.endH);
  }
  if (!isFinite(min)) {
    min = fallback.start;
    max = fallback.end;
  }
  min = Math.floor(min);
  max = Math.ceil(max);
  const cols: number[] = [];
  for (let h = min; h < max; h++) cols.push(h);
  return cols;
}

export function rosterHourLabels(hourCols: number[]): string[] {
  return hourCols.map((h) => `${hourLabel(h)} - ${hourLabel(h + 1)}`);
}

/** Build one matrix row per person for a given date. */
export function buildRosterRows(params: {
  duties: RosterDuty[];
  people: RosterPerson[];
  date: string;
  hourCols: number[];
}): RosterRow[] {
  const { duties, people, date, hourCols } = params;

  return people.map((person) => {
    const own = duties.filter((d) => d.employeeId === person.id && d.date === date);
    const totalHours =
      Math.round(own.reduce((sum, d) => sum + (d.endH - d.startH), 0) * 10) / 10;

    if (own.length === 0) {
      return { id: person.id, name: person.name, totalHours: 0, off: true, cells: [] };
    }

    // One cell per hour column; a cell is "covered" if a duty overlaps it.
    const cells: RosterCell[] = hourCols.map((h) => {
      const d = own.find((x) => x.startH < h + 1 && x.endH > h) ?? null;
      return d
        ? { label: d.label, color: d.color, showLabel: false }
        : { label: null, color: null, showLabel: false };
    });

    // Show the duty name only at the start of each band.
    for (let i = 0; i < cells.length; i++) {
      cells[i].showLabel =
        cells[i].label !== null && (i === 0 || cells[i - 1].label !== cells[i].label);
    }

    return { id: person.id, name: person.name, totalHours, off: false, cells };
  });
}

interface GapDuty {
  positionId: string;
  positionName: string;
  date: string;
  startH: number;
  endH: number;
}

/** One red "unfilled" row per position that has gaps on the date. */
export function buildGapRows(params: {
  gapDuties: GapDuty[];
  date: string;
  hourCols: number[];
}): RosterRow[] {
  const { gapDuties, date, hourCols } = params;
  const byPos = new Map<string, { name: string; items: GapDuty[] }>();
  for (const g of gapDuties) {
    if (g.date !== date) continue;
    if (!byPos.has(g.positionId)) byPos.set(g.positionId, { name: g.positionName, items: [] });
    byPos.get(g.positionId)!.items.push(g);
  }

  return [...byPos.entries()].map(([posId, { name, items }]) => {
    const totalHours =
      Math.round(items.reduce((s, g) => s + (g.endH - g.startH), 0) * 10) / 10;
    const cells: RosterCell[] = hourCols.map((h) => {
      const covered = items.some((g) => g.startH < h + 1 && g.endH > h);
      return covered
        ? { label: "GAP", color: "#dc2626", showLabel: false }
        : { label: null, color: null, showLabel: false };
    });
    for (let i = 0; i < cells.length; i++) {
      cells[i].showLabel =
        cells[i].label !== null && (i === 0 || cells[i - 1].label !== cells[i].label);
    }
    return { id: `gap-${posId}`, name: `${name} — unfilled`, totalHours, off: false, cells };
  });
}
