import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { addDaysISO, todayISO } from "@/lib/scheduler";
import { inputClass, labelClass } from "@/lib/ui";
import type { SchedulePeriod } from "@/lib/types";
import { createPeriodAndGenerate } from "./actions";

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

  const list = (periods ?? []) as SchedulePeriod[];
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
          className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
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
          <Link
            key={p.id}
            href={`/manager/schedule/${p.id}`}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-violet/60"
          >
            <span className="font-medium">
              {formatDate(p.start_date)} – {formatDate(p.end_date)}
            </span>
            <StatusBadge status={p.status} />
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: SchedulePeriod["status"] }) {
  const styles =
    status === "published" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600";
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${styles}`}>
      {status}
    </span>
  );
}
