// ============================================================================
// Coverage gap detector (Phase 4)
// ----------------------------------------------------------------------------
// Compares STAFFED headcount against the coverage_requirements floor for every
// slice of every position across a date range, then:
//   - upserts coverage_gaps rows (the unique slot key doubles as dedupe),
//   - marks previously-detected gaps resolved when they're now covered,
//   - notifies managers about NEW gaps (deduped via notifications.dedupe_key).
// Runs after every solve and whenever the manager opens Coverage & gaps.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { datesInRange, dayOfWeekISO, minToTimeStr, timeStrToMin } from "@/lib/scheduler";
import { notifyUsers } from "@/lib/notify";

const DAY = 1440;

interface DetectorSummary {
  newGaps: number;
  openGaps: number;
  resolved: number;
}

export async function detectGaps(
  supabase: SupabaseClient,
  orgId: string,
  fromDate: string,
  toDate: string,
): Promise<DetectorSummary> {
  const [posRes, reqRes, asgRes, gapRes, periodRes] = await Promise.all([
    supabase
      .from("shift_types")
      .select("id, name, start_time, end_time, required_staff, block_minutes")
      .eq("org_id", orgId),
    supabase
      .from("coverage_requirements")
      .select("id, position_id, day_of_week, start_time, end_time, min_headcount")
      .eq("org_id", orgId),
    supabase
      .from("assignments")
      .select("shift_type_id, employee_id, work_date, start_time, end_time, status")
      .eq("org_id", orgId)
      .gte("work_date", fromDate)
      .lte("work_date", toDate)
      .not("employee_id", "is", null)
      .neq("status", "open"),
    supabase
      .from("coverage_gaps")
      .select("id, position_id, work_date, start_time, end_time, resolved")
      .eq("org_id", orgId)
      .gte("work_date", fromDate)
      .lte("work_date", toDate),
    supabase
      .from("schedule_periods")
      .select("start_date, end_date")
      .eq("org_id", orgId)
      .lte("start_date", toDate)
      .gte("end_date", fromDate),
  ]);

  const positions = posRes.data ?? [];
  const reqs = reqRes.data ?? [];
  const assignments = asgRes.data ?? [];
  const existing = gapRes.data ?? [];

  // Only judge dates a schedule period actually covers — a requirement on a
  // day nobody has scheduled yet is "not scheduled", not a gap alert.
  const scheduledDates = new Set<string>();
  for (const p of periodRes.data ?? []) {
    const from = p.start_date < fromDate ? fromDate : p.start_date;
    const to = p.end_date > toDate ? toDate : p.end_date;
    for (const d of datesInRange(from, to)) scheduledDates.add(d);
  }

  // Staffed intervals per position per date (minutes; wrap past midnight).
  const staffedBy: Record<string, { s: number; e: number }[]> = {};
  for (const a of assignments) {
    if (!a.shift_type_id) continue;
    const s = timeStrToMin(a.start_time ?? "00:00");
    let e = timeStrToMin(a.end_time ?? "00:00");
    if (e <= s) e += DAY;
    (staffedBy[`${a.shift_type_id}|${a.work_date}`] ??= []).push({ s, e });
  }

  // Compute shortfalls slot by slot.
  interface GapRow {
    org_id: string;
    position_id: string;
    requirement_id: string | null;
    work_date: string;
    start_time: string;
    end_time: string;
    required: number;
    staffed: number;
    positionName: string;
  }
  const found: GapRow[] = [];
  for (const date of datesInRange(fromDate, toDate)) {
    if (!scheduledDates.has(date)) continue;
    const dow = dayOfWeekISO(date);
    for (const p of positions) {
      const bands = reqs.filter(
        (r) => r.position_id === p.id && (r.day_of_week === null || r.day_of_week === dow),
      );
      const effective =
        bands.length > 0
          ? bands
          : [
              {
                id: null as string | null,
                position_id: p.id,
                start_time: p.start_time,
                end_time: p.end_time,
                min_headcount: p.required_staff ?? 1,
              },
            ];
      for (const band of effective) {
        const s0 = timeStrToMin(band.start_time);
        let e0 = timeStrToMin(band.end_time);
        if (e0 <= s0) e0 += DAY;
        const block = p.block_minutes && p.block_minutes > 0 ? p.block_minutes : e0 - s0;
        const cover = staffedBy[`${p.id}|${date}`] ?? [];
        for (let s = s0; s < e0; s += block) {
          const e = Math.min(s + block, e0);
          const staffed = cover.filter((iv) => iv.s <= s && iv.e >= e).length;
          if (staffed < band.min_headcount) {
            found.push({
              org_id: orgId,
              position_id: p.id,
              requirement_id: band.id,
              work_date: date,
              start_time: minToTimeStr(s),
              end_time: minToTimeStr(e),
              required: band.min_headcount,
              staffed,
              positionName: p.name,
            });
          }
        }
      }
    }
  }

  // Diff against existing rows using the unique slot key.
  const keyOf = (g: { position_id: string; work_date: string; start_time: string; end_time: string }) =>
    `${g.position_id}|${g.work_date}|${g.start_time}|${g.end_time}`;
  const existingByKey = new Map(existing.map((g) => [keyOf(g), g]));
  const foundKeys = new Set(found.map(keyOf));

  const newRows = found.filter((g) => !existingByKey.has(keyOf(g)));
  const reopened = found.filter((g) => {
    const ex = existingByKey.get(keyOf(g));
    return ex && ex.resolved;
  });
  const nowResolved = existing.filter((g) => !g.resolved && !foundKeys.has(keyOf(g)));

  if (newRows.length > 0) {
    await supabase.from("coverage_gaps").insert(
      newRows.map(({ positionName: _p, ...row }) => row),
    );
  }
  for (const g of reopened) {
    const ex = existingByKey.get(keyOf(g))!;
    await supabase
      .from("coverage_gaps")
      .update({ resolved: false, staffed: g.staffed, required: g.required, detected_at: new Date().toISOString() })
      .eq("id", ex.id);
  }
  if (nowResolved.length > 0) {
    await supabase
      .from("coverage_gaps")
      .update({ resolved: true })
      .in(
        "id",
        nowResolved.map((g) => g.id),
      );
  }

  // Notify managers about new/reopened gaps — one summary per day, deduped.
  const alert = [...newRows, ...reopened];
  if (alert.length > 0) {
    const { data: managers } = await supabase
      .from("profiles")
      .select("id")
      .eq("org_id", orgId)
      .eq("role", "manager");
    const managerIds = (managers ?? []).map((m) => m.id as string);
    const byDate: Record<string, GapRow[]> = {};
    for (const g of alert) (byDate[g.work_date] ??= []).push(g);
    for (const [date, gapsOfDay] of Object.entries(byDate)) {
      const posNames = [...new Set(gapsOfDay.map((g) => g.positionName))].join(", ");
      await notifyUsers(supabase, managerIds, {
        title: `Coverage gap on ${date}`,
        body: `${gapsOfDay.length} unfilled slot(s): ${posNames}. Tap to review.`,
        link: "/manager/coverage",
        type: "coverage_gap",
        dedupeKey: `gaps:${orgId}:${date}:${gapsOfDay.length}:${posNames}`,
      });
    }
  }

  return {
    newGaps: newRows.length + reopened.length,
    openGaps: found.length,
    resolved: nowResolved.length,
  };
}
