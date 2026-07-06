import Link from "next/link";
import { Wand2 } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { detectGaps } from "@/lib/gap-detector";
import { addDaysISO, todayISO } from "@/lib/scheduler";
import { formatDate, formatTime } from "@/lib/format";
import { autoFillPeriod } from "./actions";

interface GapRow {
  id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  required: number;
  staffed: number;
  shift_types: { name: string } | null;
}

export default async function FixSchedulePage() {
  const session = await requireManager();
  const profile = session.profile!;
  const supabase = await createClient();

  const today = todayISO();
  const horizon = addDaysISO(today, 14);
  try {
    await detectGaps(supabase, profile.org_id!, today, horizon);
  } catch {
    /* page still renders */
  }

  const [{ data: gapData }, { data: periods }] = await Promise.all([
    supabase
      .from("coverage_gaps")
      .select("id, work_date, start_time, end_time, required, staffed, shift_types(name)")
      .eq("org_id", profile.org_id)
      .eq("resolved", false)
      .gte("work_date", today)
      .order("work_date")
      .order("start_time")
      .limit(200),
    supabase
      .from("schedule_periods")
      .select("id, start_date, end_date, status")
      .eq("org_id", profile.org_id)
      .gte("end_date", today)
      .order("start_date"),
  ]);

  const gaps = (gapData ?? []) as unknown as GapRow[];

  // Group each gap under the period that covers its date.
  const groups = (periods ?? [])
    .map((p) => ({
      period: p,
      gaps: gaps.filter((g) => g.work_date >= p.start_date && g.work_date <= p.end_date),
    }))
    .filter((g) => g.gaps.length > 0);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-bold">Fix schedule</h1>
      <p className="mt-1 text-slate-600">
        Slots below are missing people. <strong>Auto-fill</strong> proposes a fix without
        changing anyone&apos;s confirmed shifts — you review it before anything goes out.
      </p>

      {groups.length === 0 && (
        <p className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No unfilled slots in the next two weeks. Nothing to fix. 🎉
        </p>
      )}

      {groups.map(({ period, gaps: periodGaps }) => (
        <div
          key={period.id}
          className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="font-semibold">
                {formatDate(period.start_date)} – {formatDate(period.end_date)}
              </h2>
              <p className="text-xs text-slate-500">
                {periodGaps.length} unfilled slot(s) · schedule is {period.status}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <form action={autoFillPeriod}>
                <input type="hidden" name="period_id" value={period.id} />
                <SubmitButton className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                  <Wand2 size={15} aria-hidden /> Auto-fill
                </SubmitButton>
              </form>
              <Link
                href={`/manager/schedule/${period.id}`}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Assign manually
              </Link>
              <Link
                href="/manager/coverage"
                className="rounded-lg px-2 py-2 text-sm text-slate-500 hover:text-slate-800"
              >
                Leave it
              </Link>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Position</th>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Staffed</th>
              </tr>
            </thead>
            <tbody>
              {periodGaps.slice(0, 20).map((g) => (
                <tr key={g.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">{formatDate(g.work_date)}</td>
                  <td className="px-4 py-2">{g.shift_types?.name ?? "—"}</td>
                  <td className="px-4 py-2">
                    {formatTime(g.start_time)}–{formatTime(g.end_time)}
                  </td>
                  <td className="px-4 py-2 font-medium text-red-600">
                    {g.staffed} of {g.required}
                  </td>
                </tr>
              ))}
              {periodGaps.length > 20 && (
                <tr className="border-t border-slate-100">
                  <td colSpan={4} className="px-4 py-2 text-xs text-slate-400">
                    …and {periodGaps.length - 20} more
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
