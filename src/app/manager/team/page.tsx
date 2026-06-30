import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { SubmitButton } from "@/components/submit-button";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTime, shiftHours } from "@/lib/format";
import { inputClass, labelClass } from "@/lib/ui";
import type { Profile, ShiftType } from "@/lib/types";
import { createShiftType, deleteShiftType, updateEmployeeHours } from "../actions";

export default async function TeamSetupPage() {
  const session = await requireManager();
  const profile = session.profile!;
  const org = profile.organizations!;

  const supabase = await createClient();
  const [{ data: shifts }, { data: staff }] = await Promise.all([
    supabase
      .from("shift_types")
      .select("*")
      .eq("org_id", profile.org_id)
      .order("start_time"),
    supabase
      .from("profiles")
      .select("id, full_name, role, target_hours_per_week")
      .eq("org_id", profile.org_id)
      .eq("role", "employee")
      .order("full_name"),
  ]);

  const shiftTypes = (shifts ?? []) as ShiftType[];
  const employees = (staff ?? []) as Pick<
    Profile,
    "id" | "full_name" | "role" | "target_hours_per_week"
  >[];

  return (
    <>
      <AppHeader orgName={org.name} userName={profile.full_name ?? "Manager"} role="manager" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <Link href="/manager" className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Shifts &amp; hours</h1>
        <p className="mt-1 text-slate-600">
          Define your shift types and set each person&apos;s weekly target hours.
          The scheduler uses these to build the roster.
        </p>

        {/* ---------------- Shift types ---------------- */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Shift types</h2>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shiftTypes.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
                style={{ borderLeft: `4px solid ${s.color}` }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{s.name}</p>
                    <p className="text-sm text-slate-600">
                      {formatTime(s.start_time)} – {formatTime(s.end_time)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {shiftHours(s.start_time, s.end_time)} hrs · needs{" "}
                      {s.required_staff} staff
                    </p>
                  </div>
                  <form action={deleteShiftType}>
                    <input type="hidden" name="id" value={s.id} />
                    <button
                      className="text-slate-400 hover:text-red-600"
                      title="Delete shift type"
                    >
                      ✕
                    </button>
                  </form>
                </div>
              </div>
            ))}
            {shiftTypes.length === 0 && (
              <p className="text-sm text-slate-500">No shift types yet — add one below.</p>
            )}
          </div>

          {/* Add shift type */}
          <form
            action={createShiftType}
            className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-6"
          >
            <div className="col-span-2">
              <label className={labelClass} htmlFor="name">
                Name
              </label>
              <input id="name" name="name" required placeholder="Morning" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="start_time">
                Start
              </label>
              <input id="start_time" name="start_time" type="time" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="end_time">
                End
              </label>
              <input id="end_time" name="end_time" type="time" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="required_staff">
                Staff
              </label>
              <input
                id="required_staff"
                name="required_staff"
                type="number"
                min={1}
                defaultValue={1}
                className={inputClass}
              />
            </div>
            <div className="flex items-end">
              <input
                type="color"
                name="color"
                defaultValue="#2563eb"
                className="h-[42px] w-full cursor-pointer rounded-lg border border-slate-300"
                title="Colour"
              />
            </div>
            <div className="col-span-2 sm:col-span-6">
              <SubmitButton>Add shift type</SubmitButton>
            </div>
          </form>
        </section>

        {/* ---------------- Team hours ---------------- */}
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Weekly target hours</h2>
          <p className="mt-1 text-sm text-slate-600">
            Set how many hours each person should be scheduled per week.
          </p>

          <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {employees.length === 0 && (
              <p className="px-4 py-6 text-sm text-slate-500">
                No staff have joined yet. Share your join code{" "}
                <span className="font-mono font-semibold">{org.join_code}</span> from the dashboard.
              </p>
            )}
            {employees.map((e) => (
              <form
                key={e.id}
                action={updateEmployeeHours}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="font-medium">{e.full_name ?? "Unnamed"}</span>
                <input type="hidden" name="employee_id" value={e.id} />
                <div className="flex items-center gap-2">
                  <input
                    name="target_hours_per_week"
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={e.target_hours_per_week}
                    className="w-24 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                  <span className="text-sm text-slate-500">hrs/wk</span>
                  <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
                    Save
                  </button>
                </div>
              </form>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
