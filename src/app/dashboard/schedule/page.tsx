import Link from "next/link";
import { LogIn, LogOut } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { SubmitButton } from "@/components/submit-button";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/format";
import { todayISO } from "@/lib/scheduler";
import { checkInShift, checkOutShift, requestCoverage } from "../actions";

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

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

  // Attendance rows for today's shifts (migration 13; absent = hide buttons).
  const attQ = await supabase
    .from("attendance")
    .select("assignment_id, check_in_at, check_out_at")
    .eq("employee_id", session.userId)
    .eq("work_date", today);
  const attendanceOn = !attQ.error;
  const attByAssignment = new Map(
    ((attQ.data ?? []) as { assignment_id: string | null; check_in_at: string | null; check_out_at: string | null }[]).map(
      (a) => [a.assignment_id, a],
    ),
  );

  return (
    <>
      <AppHeader orgName={org.name} userName={profile.full_name ?? "You"} role="employee" />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-800">
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold">My schedule</h1>
        <p className="mt-1 text-slate-600">
          Your upcoming published shifts. Check in when you start today&apos;s duty.
        </p>

        <div className="mt-6 space-y-2">
          {shifts.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-card px-4 py-6 text-sm text-slate-500">
              No upcoming shifts yet. When your manager publishes a schedule,
              your shifts will appear here.
            </p>
          )}
          {shifts.map((s) => {
            const att = attByAssignment.get(s.id);
            const isToday = s.work_date === today;
            return (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-card px-4 py-3"
                style={{ borderLeft: `4px solid ${s.shift_types?.color ?? "#2563eb"}` }}
              >
                <div className="min-w-0">
                  <p className="font-medium">{formatDate(s.work_date)}</p>
                  <p className="text-sm text-slate-600">
                    {s.shift_types?.name} ·{" "}
                    {formatTime(s.start_time ?? s.shift_types?.start_time)} –{" "}
                    {formatTime(s.end_time ?? s.shift_types?.end_time)}
                  </p>
                  {att?.check_in_at && (
                    <p className="mt-0.5 text-xs text-green-700">
                      ✓ Checked in {clock(att.check_in_at)}
                      {att.check_out_at && ` · out ${clock(att.check_out_at)}`}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {attendanceOn && isToday && !att?.check_in_at && (
                    <form action={checkInShift}>
                      <input type="hidden" name="assignment_id" value={s.id} />
                      <SubmitButton
                        quiet
                        className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                      >
                        <LogIn size={13} aria-hidden /> Check in
                      </SubmitButton>
                    </form>
                  )}
                  {attendanceOn && isToday && att?.check_in_at && !att.check_out_at && (
                    <form action={checkOutShift}>
                      <input type="hidden" name="assignment_id" value={s.id} />
                      <SubmitButton
                        quiet
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <LogOut size={13} aria-hidden /> Check out
                      </SubmitButton>
                    </form>
                  )}
                  <form action={requestCoverage}>
                    <input type="hidden" name="assignment_id" value={s.id} />
                    <button className="rounded-lg border border-slate-300 bg-card px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                      Request cover
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
