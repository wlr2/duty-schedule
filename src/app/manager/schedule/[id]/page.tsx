import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DAY_NAMES, formatDate, formatTime, shiftHours } from "@/lib/format";
import type { Profile, SchedulePeriod, ShiftType } from "@/lib/types";
import { datesInRange } from "@/lib/scheduler";
import { deletePeriod, publishPeriod, regeneratePeriod } from "../actions";

interface AssignmentRow {
  id: string;
  work_date: string;
  status: string;
  shift_type_id: string | null;
  employee_id: string | null;
  start_time: string | null;
  end_time: string | null;
  profiles: { full_name: string | null } | null;
}

export default async function ScheduleReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireManager();
  const profile = session.profile!;
  const org = profile.organizations!;

  const supabase = await createClient();
  const { data: period } = await supabase
    .from("schedule_periods")
    .select("*")
    .eq("id", id)
    .eq("org_id", profile.org_id)
    .maybeSingle();

  if (!period) notFound();
  const p = period as SchedulePeriod;

  const [{ data: shiftData }, { data: assignmentData }, { data: staffData }] =
    await Promise.all([
      supabase.from("shift_types").select("*").eq("org_id", profile.org_id).order("start_time"),
      supabase
        .from("assignments")
        .select(
          "id, work_date, status, shift_type_id, employee_id, start_time, end_time, profiles(full_name)",
        )
        .eq("period_id", id),
      supabase
        .from("profiles")
        .select("id, full_name, target_hours_per_week")
        .eq("org_id", profile.org_id)
        .eq("role", "employee"),
    ]);

  const shifts = (shiftData ?? []) as ShiftType[];
  const assignments = (assignmentData ?? []) as unknown as AssignmentRow[];
  const employees = (staffData ?? []) as Pick<
    Profile,
    "id" | "full_name" | "target_hours_per_week"
  >[];
  const dates = datesInRange(p.start_date, p.end_date);

  // grid[date][shiftId] = AssignmentRow[]
  const grid: Record<string, Record<string, AssignmentRow[]>> = {};
  for (const d of dates) grid[d] = {};
  const shiftLen: Record<string, number> = {};
  for (const s of shifts) shiftLen[s.id] = shiftHours(s.start_time, s.end_time);

  const hoursByEmp: Record<string, number> = {};
  let openSlots = 0;
  for (const a of assignments) {
    if (!a.shift_type_id) continue;
    (grid[a.work_date] ??= {});
    (grid[a.work_date][a.shift_type_id] ??= []).push(a);
    if (a.employee_id) {
      hoursByEmp[a.employee_id] = (hoursByEmp[a.employee_id] ?? 0) + (shiftLen[a.shift_type_id] ?? 0);
    } else {
      openSlots++;
    }
  }

  return (
    <>
      <AppHeader orgName={org.name} userName={profile.full_name ?? "Manager"} role="manager" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <Link href="/manager/schedule" className="text-sm text-slate-500 hover:text-slate-800">
          ← All schedules
        </Link>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">
              {formatDate(p.start_date)} – {formatDate(p.end_date)}
            </h1>
            <p className="mt-1 text-sm capitalize text-slate-600">
              Status: {p.status}
              {openSlots > 0 && (
                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  {openSlots} open slot{openSlots === 1 ? "" : "s"}
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <form action={regeneratePeriod}>
              <input type="hidden" name="period_id" value={p.id} />
              <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100">
                🔄 Regenerate
              </button>
            </form>
            {p.status === "draft" && (
              <form action={publishPeriod}>
                <input type="hidden" name="period_id" value={p.id} />
                <button className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700">
                  ✓ Publish
                </button>
              </form>
            )}
            <form action={deletePeriod}>
              <input type="hidden" name="period_id" value={p.id} />
              <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                Delete
              </button>
            </form>
          </div>
        </div>

        {/* Roster grid */}
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-500">
                <th className="sticky left-0 bg-slate-50 px-4 py-2 font-medium">Date</th>
                {shifts.map((s) => (
                  <th key={s.id} className="px-4 py-2 font-medium">
                    <span style={{ color: s.color }}>●</span> {s.name}
                    <span className="ml-1 font-normal text-slate-400">
                      {formatTime(s.start_time)}–{formatTime(s.end_time)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dates.map((d) => {
                const dow = new Date(d + "T00:00:00").getDay();
                return (
                  <tr key={d} className="border-t border-slate-100">
                    <td className="sticky left-0 bg-white px-4 py-2 font-medium whitespace-nowrap">
                      {DAY_NAMES[dow].slice(0, 3)} {formatDate(d).split(", ")[1]}
                    </td>
                    {shifts.map((s) => {
                      const cell = grid[d]?.[s.id] ?? [];
                      return (
                        <td key={s.id} className="px-4 py-2 align-top">
                          {cell.length === 0 ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <div className="space-y-1">
                              {cell.map((a) =>
                                a.employee_id ? (
                                  <div key={a.id} className="text-slate-800">
                                    {a.profiles?.full_name ?? "Unnamed"}
                                    {a.start_time && (
                                      <span className="ml-1 text-xs text-slate-400">
                                        {formatTime(a.start_time)}–{formatTime(a.end_time)}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <div
                                    key={a.id}
                                    className="inline-block rounded bg-red-50 px-1.5 text-xs font-medium text-red-600"
                                  >
                                    OPEN
                                  </div>
                                ),
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Hours summary */}
        <h2 className="mt-8 text-lg font-semibold">Hours this period</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((e) => {
            const target = (e.target_hours_per_week * dates.length) / 7;
            const scheduled = hoursByEmp[e.id] ?? 0;
            return (
              <div
                key={e.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <span className="font-medium">{e.full_name ?? "Unnamed"}</span>
                <span className="text-sm text-slate-600">
                  {scheduled}h{" "}
                  <span className="text-slate-400">/ {Math.round(target)}h target</span>
                </span>
              </div>
            );
          })}
          {employees.length === 0 && (
            <p className="text-sm text-slate-500">No staff have joined yet.</p>
          )}
        </div>
      </main>
    </>
  );
}
