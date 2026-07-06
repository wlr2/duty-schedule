import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/format";
import { todayISO } from "@/lib/scheduler";
import { requestCoverage } from "../actions";

interface MyShift {
  id: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  shift_types: {
    name: string;
    color: string;
    start_time: string;
    end_time: string;
  } | null;
}

export default async function MySchedulePage() {
  const session = await requireProfile();
  const profile = session.profile!;
  const org = profile.organizations!;
  const today = todayISO();

  const supabase = await createClient();
  const { data } = await supabase
    .from("assignments")
    .select(
      "id, work_date, start_time, end_time, shift_types(name,color,start_time,end_time), schedule_periods!inner(status)",
    )
    .eq("employee_id", session.userId)
    .eq("schedule_periods.status", "published")
    .gte("work_date", today)
    .order("work_date");

  const shifts = (data ?? []) as unknown as MyShift[];

  return (
    <>
      <AppHeader orgName={org.name} userName={profile.full_name ?? "You"} role="employee" />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-800">
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold">My schedule</h1>
        <p className="mt-1 text-slate-600">Your upcoming published shifts.</p>

        <div className="mt-6 space-y-2">
          {shifts.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
              No upcoming shifts yet. When your manager publishes a schedule,
              your shifts will appear here.
            </p>
          )}
          {shifts.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
              style={{ borderLeft: `4px solid ${s.shift_types?.color ?? "#2563eb"}` }}
            >
              <div>
                <p className="font-medium">{formatDate(s.work_date)}</p>
                <p className="text-sm text-slate-600">
                  {s.shift_types?.name} ·{" "}
                  {formatTime(s.start_time ?? s.shift_types?.start_time)} –{" "}
                  {formatTime(s.end_time ?? s.shift_types?.end_time)}
                </p>
              </div>
              <form action={requestCoverage}>
                <input type="hidden" name="assignment_id" value={s.id} />
                <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                  Request cover
                </button>
              </form>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
