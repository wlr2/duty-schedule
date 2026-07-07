import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { SubmitButton } from "@/components/submit-button";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DAY_NAMES, formatDate } from "@/lib/format";
import { todayISO } from "@/lib/scheduler";
import { inputClass, labelClass } from "@/lib/ui";
import type { PreferenceLevel } from "@/lib/types";
import { cancelDayOff, requestDayOff, saveAvailability } from "../actions";

const LEVELS: { value: PreferenceLevel; label: string }[] = [
  { value: "preferred", label: "Preferred" },
  { value: "available", label: "Available" },
  { value: "unavailable", label: "Unavailable" },
];

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  pending: { label: "Awaiting approval", cls: "bg-amber-50 text-amber-800" },
  approved: { label: "Approved", cls: "bg-green-100 text-green-800" },
  rejected: { label: "Declined", cls: "bg-red-100 text-red-700" },
};

export default async function AvailabilityPage() {
  const session = await requireProfile();
  const profile = session.profile!;
  const org = profile.organizations!;

  const supabase = await createClient();
  const [{ data: prefData }, { data: exData }] = await Promise.all([
    supabase.from("employee_preferences").select("*").eq("employee_id", session.userId),
    supabase
      .from("availability_exceptions")
      .select("*")
      .eq("employee_id", session.userId)
      .gte("work_date", todayISO())
      .order("work_date"),
  ]);

  const prefs = (prefData ?? []) as {
    day_of_week: number;
    preference: PreferenceLevel;
    status?: string;
  }[];
  const current = new Map(prefs.map((p) => [p.day_of_week, p]));
  const exceptions = (exData ?? []) as {
    id: string;
    work_date: string;
    reason: string | null;
    status?: string;
  }[];

  return (
    <>
      <AppHeader orgName={org.name} userName={profile.full_name ?? "You"} role="employee" />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft size={15} aria-hidden /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Weekly availability</h1>
        <p className="mt-1 text-slate-600">
          Set which days you can normally work. Marking a day{" "}
          <strong>Unavailable</strong> goes to your manager for approval first.
        </p>

        <form action={saveAvailability} className="mt-6 space-y-2">
          {DAY_NAMES.map((day, d) => {
            const row = current.get(d);
            const value = row?.preference ?? "available";
            const pendingUnavailable =
              row?.preference === "unavailable" && (row?.status ?? "approved") === "pending";
            return (
              <div
                key={d}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-card px-4 py-3"
              >
                <span className="font-medium">
                  {day}
                  {pendingUnavailable && (
                    <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Awaiting approval
                    </span>
                  )}
                </span>
                <select
                  name={`day_${d}`}
                  defaultValue={value}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                >
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <div className="pt-2">
            <SubmitButton>Save availability</SubmitButton>
          </div>
        </form>

        {/* Day-specific unavailability (on top of the weekly pattern). */}
        <h2 className="mt-10 text-lg font-semibold">Specific days you can&apos;t work</h2>
        <p className="mt-1 text-sm text-slate-600">
          One-off dates (appointments, events). Your manager approves these too.
        </p>

        <form
          action={requestDayOff}
          className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-card p-4"
        >
          <div>
            <label className={labelClass} htmlFor="work_date">Date</label>
            <input
              id="work_date"
              name="work_date"
              type="date"
              required
              min={todayISO()}
              className={inputClass}
            />
          </div>
          <div className="min-w-40 flex-1">
            <label className={labelClass} htmlFor="reason">Reason (optional)</label>
            <input id="reason" name="reason" type="text" placeholder="e.g. appointment" className={inputClass} />
          </div>
          <SubmitButton>Request day off</SubmitButton>
        </form>

        <div className="mt-3 space-y-2">
          {exceptions.map((ex) => {
            const chip = STATUS_CHIP[ex.status ?? "approved"] ?? STATUS_CHIP.approved;
            return (
              <div
                key={ex.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-card px-4 py-2.5"
              >
                <div className="min-w-0">
                  <span className="font-medium">{formatDate(ex.work_date)}</span>
                  {ex.reason && <span className="ml-2 text-sm text-slate-500">{ex.reason}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip.cls}`}>
                    {chip.label}
                  </span>
                  <form action={cancelDayOff}>
                    <input type="hidden" name="id" value={ex.id} />
                    <ConfirmSubmit
                      message={`Remove your day off on ${formatDate(ex.work_date)}? You'd be schedulable again.`}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Remove
                    </ConfirmSubmit>
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
