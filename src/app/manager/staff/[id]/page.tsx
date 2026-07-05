import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DAY_NAMES, formatDate, timeToHours } from "@/lib/format";
import { leaveLabel, leaveStatus } from "@/lib/leave";
import { inputClass, labelClass } from "@/lib/ui";
import type { EmployeePreference, LeaveRequest, Profile } from "@/lib/types";
import { setPay, updateEmployeeHours } from "../../actions";

const PREF_LABEL: Record<string, string> = {
  preferred: "Preferred",
  available: "Available",
  unavailable: "Unavailable",
};

export default async function StaffProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireManager();
  const orgId = session.profile!.org_id;

  const supabase = await createClient();
  const { data: emp } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!emp) notFound();
  const person = emp as Profile;

  const [{ data: assigns }, { data: prefData }, { data: leaveData }] = await Promise.all([
    supabase
      .from("assignments")
      .select("start_time, end_time, shift_types(start_time, end_time)")
      .eq("employee_id", id),
    supabase.from("employee_preferences").select("day_of_week, preference").eq("employee_id", id),
    supabase
      .from("leave_requests")
      .select("*")
      .eq("employee_id", id)
      .order("created_at", { ascending: false }),
  ]);

  type RawA = {
    start_time: string | null;
    end_time: string | null;
    shift_types: { start_time: string; end_time: string } | null;
  };
  const hoursWorked = ((assigns ?? []) as unknown as RawA[]).reduce((sum, a) => {
    const s = timeToHours(a.start_time ?? a.shift_types?.start_time);
    const e = timeToHours(a.end_time ?? a.shift_types?.end_time);
    return sum + (s != null && e != null && e > s ? e - s : 0);
  }, 0);

  const prefs = new Map(
    ((prefData ?? []) as Pick<EmployeePreference, "day_of_week" | "preference">[]).map((p) => [
      p.day_of_week,
      p.preference,
    ]),
  );
  const leaves = (leaveData ?? []) as LeaveRequest[];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        href="/manager/staff"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} aria-hidden /> Team
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{person.full_name ?? "Unnamed"}</h1>
      <p className="mt-1 text-slate-600">Employee profile</p>

      {/* Top stats */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <form
          action={updateEmployeeHours}
          className="rounded-2xl border border-slate-200 bg-white p-5"
        >
          <h2 className="text-sm font-medium text-slate-500">Required hours / week</h2>
          <input type="hidden" name="employee_id" value={person.id} />
          <div className="mt-2 flex items-center gap-2">
            <input
              name="target_hours_per_week"
              type="number"
              min={0}
              defaultValue={person.target_hours_per_week}
              className="w-24 rounded-lg border border-slate-300 px-3 py-1.5 text-lg font-bold"
            />
            <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
              Save
            </button>
          </div>
        </form>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-medium text-slate-500">Hours scheduled (all time)</h2>
          <p className="mt-2 text-3xl font-bold">{Math.round(hoursWorked)}</p>
          <p className="text-sm text-slate-500">across every roster</p>
        </div>
      </div>

      {/* Weekly availability */}
      <h2 className="mt-8 text-lg font-semibold">Weekly availability</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {DAY_NAMES.map((day, d) => {
          const p = prefs.get(d) ?? "available";
          const tone =
            p === "preferred"
              ? "bg-green-100 text-green-800"
              : p === "unavailable"
                ? "bg-red-100 text-red-700"
                : "bg-slate-100 text-slate-600";
          return (
            <span key={d} className={`rounded-lg px-2.5 py-1 text-xs font-medium ${tone}`}>
              {day.slice(0, 3)}: {PREF_LABEL[p]}
            </span>
          );
        })}
      </div>

      {/* Leave history */}
      <h2 className="mt-8 text-lg font-semibold">Leave history</h2>
      <div className="mt-2 space-y-2">
        {leaves.length === 0 && <p className="text-sm text-slate-500">No leave on record.</p>}
        {leaves.map((l) => (
          <div
            key={l.id}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5"
          >
            <p className="text-sm">
              <span className="font-medium">{leaveLabel(l.category)}</span> ·{" "}
              {formatDate(l.start_date)} – {formatDate(l.end_date)}
            </p>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${leaveStatus(l.status).cls}`}>
              {leaveStatus(l.status).label}
            </span>
          </div>
        ))}
      </div>

      {/* Compensation (modular scaffold) */}
      <h2 className="mt-8 text-lg font-semibold">Compensation</h2>
      <form
        action={setPay}
        className="mt-2 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-3"
      >
        <input type="hidden" name="employee_id" value={person.id} />
        <div>
          <label className={labelClass} htmlFor="pay_type">Pay type</label>
          <select id="pay_type" name="pay_type" defaultValue={person.pay_type ?? ""} className={inputClass}>
            <option value="">Not set</option>
            <option value="hourly">Hourly</option>
            <option value="salary">Salary</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="pay_rate">Rate</label>
          <input id="pay_rate" name="pay_rate" type="number" min={0} step="0.01" defaultValue={person.pay_rate ?? ""} placeholder="0.00" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="overtime_multiplier">Overtime ×</label>
          <input id="overtime_multiplier" name="overtime_multiplier" type="number" min={1} step="0.1" defaultValue={person.overtime_multiplier ?? ""} placeholder="1.5" className={inputClass} />
        </div>
        <div className="sm:col-span-3">
          <SubmitButton>Save pay</SubmitButton>
          <span className="ml-2 text-xs text-slate-400">
            Stored for later — full payroll calculations come next.
          </span>
        </div>
      </form>
    </div>
  );
}
