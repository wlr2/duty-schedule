import Link from "next/link";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { SubmitButton } from "@/components/submit-button";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { addDaysISO, todayISO } from "@/lib/scheduler";
import { inputClass, labelClass } from "@/lib/ui";
import type { SchedulePeriod } from "@/lib/types";
import { archivePeriod, createPeriodAndGenerate, deletePeriodFromList, unarchivePeriod } from "./actions";

function isoDate(offsetDays: number): string {
  return addDaysISO(todayISO(), offsetDays);
}

export default async function ScheduleListPage() {
  const session = await requireManager();
  const profile = session.profile!;

  const supabase = await createClient();
  const [{ data: periods }, { count: shiftCount }] = await Promise.all([
    supabase
      .from("schedule_periods")
      .select("*")
      .eq("org_id", profile.org_id)
      .order("start_date", { ascending: false }),
    supabase
      .from("shift_types")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id),
  ]);

  const all = (periods ?? []) as SchedulePeriod[];
  const list = all.filter((p) => p.status !== "archived");
  const archived = all.filter((p) => p.status === "archived");
  const hasShifts = (shiftCount ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-bold">Schedules</h1>
      <p className="mt-1 text-slate-600">
        Pick a date range and DutyRoster builds continuous coverage automatically.
      </p>

      {!hasShifts ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Add at least one position first.{" "}
          <Link href="/manager/team" className="font-semibold underline">
            Go to Positions →
          </Link>
        </div>
      ) : (
        <form
          action={createPeriodAndGenerate}
          className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-card p-4"
        >
          <div>
            <label className={labelClass} htmlFor="start_date">From</label>
            <input id="start_date" name="start_date" type="date" required defaultValue={isoDate(0)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="end_date">To</label>
            <input id="end_date" name="end_date" type="date" required defaultValue={isoDate(13)} className={inputClass} />
          </div>
          <SubmitButton>Generate roster</SubmitButton>
        </form>
      )}

      <div className="mt-8 space-y-2">
        {list.length === 0 && <p className="text-sm text-slate-500">No schedules yet.</p>}
        {list.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-card px-4 py-2.5 hover:border-violet/60"
          >
            <Link
              href={`/manager/schedule/${p.id}`}
              className="min-w-0 flex-1 py-0.5 font-medium"
            >
              {formatDate(p.start_date)} – {formatDate(p.end_date)}
            </Link>
            <StatusBadge status={p.status} />
            {p.status === "draft" && (
              <form action={deletePeriodFromList}>
                <input type="hidden" name="period_id" value={p.id} />
                <ConfirmSubmit
                  message={`Delete the draft ${formatDate(p.start_date)} – ${formatDate(p.end_date)}? This cannot be undone.`}
                  className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={16} aria-hidden />
                  <span className="sr-only">Delete draft</span>
                </ConfirmSubmit>
              </form>
            )}
            {p.status === "published" && (
              <form action={archivePeriod}>
                <input type="hidden" name="period_id" value={p.id} />
                <SubmitButton
                  quiet
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                  title="Archive (move out of the way; restorable anytime)"
                >
                  <Archive size={16} aria-hidden />
                  <span className="sr-only">Archive</span>
                </SubmitButton>
              </form>
            )}
          </div>
        ))}
      </div>

      {archived.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-slate-500 hover:text-slate-800">
            Archived schedules ({archived.length})
          </summary>
          <div className="mt-2 space-y-2">
            {archived.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5"
              >
                <Link
                  href={`/manager/schedule/${p.id}`}
                  className="min-w-0 flex-1 py-0.5 text-sm font-medium text-slate-600"
                >
                  {formatDate(p.start_date)} – {formatDate(p.end_date)}
                </Link>
                <form action={unarchivePeriod}>
                  <input type="hidden" name="period_id" value={p.id} />
                  <SubmitButton
                    quiet
                    className="inline-flex items-center gap-1 rounded-lg p-1.5 text-xs text-slate-500 hover:bg-slate-100"
                    title="Restore to published"
                  >
                    <ArchiveRestore size={15} aria-hidden /> Restore
                  </SubmitButton>
                </form>
                <form action={deletePeriodFromList}>
                  <input type="hidden" name="period_id" value={p.id} />
                  <ConfirmSubmit
                    message="Permanently delete this archived schedule?"
                    className="rounded-lg p-1.5 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={15} aria-hidden />
                    <span className="sr-only">Delete</span>
                  </ConfirmSubmit>
                </form>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: SchedulePeriod["status"] }) {
  const styles =
    status === "published"
      ? "bg-green-100 text-green-800"
      : status === "archived"
        ? "bg-slate-100 text-slate-500"
        : "bg-slate-100 text-slate-600";
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${styles}`}>
      {status}
    </span>
  );
}
