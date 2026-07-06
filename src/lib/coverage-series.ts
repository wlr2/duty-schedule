// Builds the staffed-vs-required series for the signature coverage chart.
import { dayOfWeekISO, timeStrToMin } from "@/lib/scheduler";

export interface StaffedInterval {
  s: number;
  e: number;
}

export interface RequirementBandLite {
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  min_headcount: number;
}

export interface CoverageSeriesPoint {
  min: number;
  staffed: number;
  required: number;
}

/** Staffed + required headcount at every change-point across one date. */
export function buildCoverageSeries(
  date: string,
  staffed: StaffedInterval[],
  bands: RequirementBandLite[],
): { points: CoverageSeriesPoint[]; startMin: number; endMin: number } {
  const dow = dayOfWeekISO(date);
  const todayBands = bands
    .filter((b) => b.day_of_week === null || b.day_of_week === dow)
    .map((b) => {
      const s = timeStrToMin(b.start_time);
      let e = timeStrToMin(b.end_time);
      if (e <= s) e += 1440;
      return { s, e, n: b.min_headcount };
    });

  const cuts = new Set<number>();
  for (const iv of staffed) {
    cuts.add(iv.s);
    cuts.add(iv.e);
  }
  for (const b of todayBands) {
    cuts.add(b.s);
    cuts.add(b.e);
  }
  if (cuts.size === 0) return { points: [], startMin: 0, endMin: 1440 };

  const sorted = [...cuts].sort((a, b) => a - b);
  const startMin = sorted[0];
  const endMin = sorted[sorted.length - 1];

  const points: CoverageSeriesPoint[] = [];
  for (const t of sorted) {
    if (t >= endMin) break;
    points.push({
      min: t,
      staffed: staffed.filter((iv) => iv.s <= t && iv.e > t).length,
      required: todayBands.filter((b) => b.s <= t && b.e > t).reduce((acc, b) => acc + b.n, 0),
    });
  }
  return { points, startMin, endMin };
}
