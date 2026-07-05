import { Users, X } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTime } from "@/lib/format";
import { inputClass, labelClass } from "@/lib/ui";
import type { PositionMember, Profile, ShiftType } from "@/lib/types";
import { createPosition, deletePosition, setEligibility } from "../actions";

export default async function PositionsPage() {
  const session = await requireManager();
  const profile = session.profile!;

  const supabase = await createClient();
  const [{ data: posData }, { data: memData }, { data: staffData }] = await Promise.all([
    supabase.from("shift_types").select("*").eq("org_id", profile.org_id).order("start_time"),
    supabase.from("position_members").select("position_id, employee_id").eq("org_id", profile.org_id),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", profile.org_id)
      .eq("role", "employee")
      .order("full_name"),
  ]);

  const positions = (posData ?? []) as ShiftType[];
  const members = (memData ?? []) as Pick<PositionMember, "position_id" | "employee_id">[];
  const employees = (staffData ?? []) as Pick<Profile, "id" | "full_name">[];
  const membersByPos = new Map<string, Set<string>>();
  for (const m of members) {
    if (!membersByPos.has(m.position_id)) membersByPos.set(m.position_id, new Set());
    membersByPos.get(m.position_id)!.add(m.employee_id);
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-bold">Positions</h1>
        <p className="mt-1 text-slate-600">
          A position is a role that needs people on duty — e.g. Sentry (1 at a
          time, rotating) or Dishwasher (5 at once, one shift). The scheduler keeps
          each one continuously covered.
        </p>

        {/* Existing positions */}
        <div className="mt-6 space-y-3">
          {positions.length === 0 && (
            <p className="text-sm text-slate-500">No positions yet — add one below.</p>
          )}
          {positions.map((p) => {
            const set = membersByPos.get(p.id) ?? new Set<string>();
            const rotation =
              p.block_minutes == null
                ? "One continuous shift"
                : `Rotate every ${p.block_minutes / 60}h · ${p.min_rest_minutes / 60}h rest`;
            return (
              <div
                key={p.id}
                className="rounded-2xl border border-slate-200 bg-white p-5"
                style={{ borderLeft: `5px solid ${p.color}` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-slate-600">
                      {formatTime(p.start_time)} – {formatTime(p.end_time)} ·{" "}
                      <strong>{p.required_staff}</strong> on duty at once
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{rotation}</p>
                  </div>
                  <form action={deletePosition}>
                    <input type="hidden" name="id" value={p.id} />
                    <ConfirmSubmit
                      message={`Delete the "${p.name}" position?`}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <X size={16} aria-hidden />
                    </ConfirmSubmit>
                  </form>
                </div>

                {/* Eligibility */}
                <form action={setEligibility} className="mt-3 border-t border-slate-100 pt-3">
                  <input type="hidden" name="position_id" value={p.id} />
                  <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <Users size={13} aria-hidden /> Who can work this?
                    <span className="font-normal">
                      {set.size === 0 ? "everyone" : `${set.size} selected`}
                    </span>
                  </p>
                  {employees.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-400">No staff yet.</p>
                  ) : (
                    <>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {employees.map((e) => (
                          <label
                            key={e.id}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white"
                          >
                            <input
                              type="checkbox"
                              name="employee_ids"
                              value={e.id}
                              defaultChecked={set.has(e.id)}
                              className="sr-only"
                            />
                            {e.full_name ?? "Unnamed"}
                          </label>
                        ))}
                      </div>
                      <button className="mt-2 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-100">
                        Save eligibility
                      </button>
                      <span className="ml-2 text-xs text-slate-400">Leave all unselected = everyone.</span>
                    </>
                  )}
                </form>
              </div>
            );
          })}
        </div>

        {/* Add position */}
        <form
          action={createPosition}
          className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
        >
          <h2 className="font-semibold">Add a position</h2>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2">
              <label className={labelClass} htmlFor="name">Name</label>
              <input id="name" name="name" required placeholder="Sentry" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="start_time">From</label>
              <input id="start_time" name="start_time" type="time" required defaultValue="08:00" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="end_time">To</label>
              <input id="end_time" name="end_time" type="time" required defaultValue="20:00" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="headcount">On duty at once</label>
              <input id="headcount" name="headcount" type="number" min={1} defaultValue={1} className={inputClass} />
            </div>
            <div className="flex items-end">
              <input type="color" name="color" defaultValue="#2563eb" className="h-[42px] w-full cursor-pointer rounded-lg border border-slate-300" title="Colour" />
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="rotate_hours">Each person works (hrs)</label>
                <input id="rotate_hours" name="rotate_hours" type="number" min={0.5} step={0.5} defaultValue={2} className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="rest_hours">…then rests (hrs)</label>
                <input id="rest_hours" name="rest_hours" type="number" min={0} step={0.5} defaultValue={2} className={inputClass} />
              </div>
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="continuous" />
              One continuous shift instead (no rotation — best for normal jobs)
            </label>
          </div>

          <SubmitButton>Add position</SubmitButton>
        </form>
    </div>
  );
}
