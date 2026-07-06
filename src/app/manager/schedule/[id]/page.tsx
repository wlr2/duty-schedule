import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, RefreshCw, Trash2 } from "lucide-react";
import { RosterMatrix } from "@/components/roster-matrix";
import { ExportImageButton } from "@/components/export-image-button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { datesInRange } from "@/lib/scheduler";
import {
  buildGapRows,
  buildRosterRows,
  rosterHourColumns,
  rosterHourLabels,
  type RosterDuty,
} from "@/lib/roster";
import { formatDate, timeToHours } from "@/lib/format";
import type { Profile, SchedulePeriod, ShiftType } from "@/lib/types";
import { deletePeriod, publishPeriod, regeneratePeriod } from "../actions";

interface RawAssignment {
  id: string;
  work_date: string;
  employee_id: string | null;
  shift_type_id: string | null;
  start_time: string | null;
  end_time: string | null;
  shift_types: { name: string; color: string; start_time: string; end_time: string } | null;
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
          "id, work_date, employee_id, shift_type_id, start_time, end_time, shift_types(name,color,start_time,end_time)",
        )
        .eq("period_id", id),
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("org_id", profile.org_id)
        .eq("role", "employee")
        .order("full_name"),
    ]);

  const shiftTypes = (shiftData ?? []) as ShiftType[];
  const raw = (assignmentData ?? []) as unknown as RawAssignment[];
  const employees = (staffData ?? []) as Pick<Profile, "id" | "full_name">[];
  const dates = datesInRange(p.start_date, p.end_date);

  // Resolve each assignment to a concrete hour range + duty label/colour.
  // Per-assignment times win; otherwise fall back to the shift type's times.
  const duties: RosterDuty[] = raw
    .filter((a) => a.employee_id)
    .map((a) => ({
      employeeId: a.employee_id as string,
      date: a.work_date,
      startH: timeToHours(a.start_time ?? a.shift_types?.start_time) ?? 0,
      endH: timeToHours(a.end_time ?? a.shift_types?.end_time) ?? 0,
      label: a.shift_types?.name ?? "Duty",
      color: a.shift_types?.color ?? "#475569",
    }));

  // Unfilled slots become red "gap" rows so the manager sees what needs cover.
  const gapDuties = raw
    .filter((a) => !a.employee_id)
    .map((a) => ({
      positionId: a.shift_type_id ?? "unknown",
      positionName: a.shift_types?.name ?? "Position",
      date: a.work_date,
      startH: timeToHours(a.start_time ?? a.shift_types?.start_time) ?? 0,
      endH: timeToHours(a.end_time ?? a.shift_types?.end_time) ?? 0,
    }));

  const people = employees.map((e) => ({ id: e.id, name: e.full_name ?? "Unnamed" }));
  const hourCols = rosterHourColumns([...duties, ...gapDuties]);
  const hourLabels = rosterHourLabels(hourCols);
  const totalOpen = gapDuties.length;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <RealtimeRefresh orgId={profile.org_id!} />
        <Link href="/manager/schedule" className="text-sm text-slate-500 hover:text-slate-800">
          ← All schedules
        </Link>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">
              {formatDate(p.start_date)}
              {p.end_date !== p.start_date && ` – ${formatDate(p.end_date)}`}
            </h1>
            <p className="mt-1 text-sm capitalize text-slate-600">
              Status: {p.status}
              {totalOpen > 0 && (
                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                  {totalOpen} unfilled
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {duties.length > 0 && (
              <ExportImageButton
                targetId="roster-capture"
                filename={`duty-roster-${p.start_date}.png`}
              />
            )}
            <form action={regeneratePeriod}>
              <input type="hidden" name="period_id" value={p.id} />
              <button className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100">
                <RefreshCw size={15} aria-hidden /> Regenerate
              </button>
            </form>
            {p.status === "draft" && (
              <form action={publishPeriod}>
                <input type="hidden" name="period_id" value={p.id} />
                <button className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                  <Check size={15} aria-hidden /> Publish
                </button>
              </form>
            )}
            <form action={deletePeriod}>
              <input type="hidden" name="period_id" value={p.id} />
              <ConfirmSubmit
                message={`Delete this ${p.status} schedule? This cannot be undone.`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <Trash2 size={15} aria-hidden /> Delete
              </ConfirmSubmit>
            </form>
          </div>
        </div>

        {/* Everything inside #roster-capture is included in the exported image. */}
        <div id="roster-capture" className="mt-4 rounded-xl bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-slate-800">
              {org.name} — duty roster
              <span className="ml-2 font-normal text-slate-500">
                {formatDate(p.start_date)}
                {p.end_date !== p.start_date && ` – ${formatDate(p.end_date)}`}
              </span>
            </p>
            {shiftTypes.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                {shiftTypes.map((s) => (
                  <span key={s.id} className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-3 w-3 rounded-sm"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.name}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm bg-red-500" />
                  Off duty
                </span>
              </div>
            )}
          </div>

          <div className="space-y-8">
            {duties.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                No duties yet. Click <strong>Regenerate</strong>, or seed a roster.
              </p>
            ) : (
              dates.map((date) => (
                <section key={date}>
                  {dates.length > 1 && (
                    <h2 className="mb-2 font-semibold">{formatDate(date)}</h2>
                  )}
                  <RosterMatrix
                    hourLabels={hourLabels}
                    rows={[
                      ...buildRosterRows({ duties, people, date, hourCols }),
                      ...buildGapRows({ gapDuties, date, hourCols }),
                    ]}
                  />
                </section>
              ))
            )}
          </div>
        </div>
    </div>
  );
}
