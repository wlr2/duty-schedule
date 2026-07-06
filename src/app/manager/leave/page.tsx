import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DAY_NAMES, formatDate } from "@/lib/format";
import { leaveLabel, leaveStatus } from "@/lib/leave";
import type { LeaveRequest } from "@/lib/types";
import { reviewAvailability, reviewLeave } from "../actions";

export default async function ManagerLeavePage() {
  const session = await requireManager();
  const profile = session.profile!;

  const supabase = await createClient();
  const [{ data: leaveData }, { data: people }, prefQ, exQ] = await Promise.all([
    supabase
      .from("leave_requests")
      .select("*")
      .eq("org_id", profile.org_id)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("org_id", profile.org_id),
    supabase
      .from("employee_preferences")
      .select("id, employee_id, day_of_week")
      .eq("org_id", profile.org_id)
      .eq("status", "pending"),
    supabase
      .from("availability_exceptions")
      .select("id, employee_id, work_date, reason")
      .eq("org_id", profile.org_id)
      .eq("status", "pending"),
  ]);

  const leaves = (leaveData ?? []) as LeaveRequest[];
  const nameById = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const pending = leaves.filter((l) => l.status === "pending");
  const history = leaves.filter((l) => l.status !== "pending");
  // Pre-migration-11 these queries error; treat as "none pending".
  const pendingPrefs = (prefQ.error ? [] : (prefQ.data ?? [])) as {
    id: string;
    employee_id: string;
    day_of_week: number;
  }[];
  const pendingDays = (exQ.error ? [] : (exQ.data ?? [])) as {
    id: string;
    employee_id: string;
    work_date: string;
    reason: string | null;
  }[];
  const availabilityPending = pendingPrefs.length + pendingDays.length;

  return (
    <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-bold">Leave requests</h1>

        <h2 className="mt-6 text-sm font-medium uppercase tracking-wide text-slate-500">
          Pending ({pending.length})
        </h2>
        <div className="mt-2 space-y-2">
          {pending.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-card px-4 py-6 text-sm text-slate-500">
              Nothing waiting for approval.
            </p>
          )}
          {pending.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-card px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {nameById.get(r.employee_id) ?? "Unnamed"}
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {leaveLabel(r.category)}
                    </span>
                  </p>
                  <p className="text-sm text-slate-600">
                    {formatDate(r.start_date)} – {formatDate(r.end_date)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <form action={reviewLeave}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="decision" value="approved" />
                    <button className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                      Approve
                    </button>
                  </form>
                  <form action={reviewLeave}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="decision" value="rejected" />
                    <button className="rounded-lg border border-slate-300 bg-card px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ))}
        </div>

        <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-slate-500">
          Availability approvals ({availabilityPending})
        </h2>
        <div className="mt-2 space-y-2">
          {availabilityPending === 0 && (
            <p className="rounded-xl border border-slate-200 bg-card px-4 py-4 text-sm text-slate-500">
              No availability changes waiting.
            </p>
          )}
          {pendingDays.map((ex) => (
            <div key={ex.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-card px-4 py-3">
              <div>
                <p className="font-medium">{nameById.get(ex.employee_id) ?? "Unnamed"}</p>
                <p className="text-sm text-slate-600">
                  Day off: {formatDate(ex.work_date)}
                  {ex.reason && <span className="text-slate-500"> — {ex.reason}</span>}
                </p>
              </div>
              <div className="flex gap-2">
                <form action={reviewAvailability}>
                  <input type="hidden" name="kind" value="exception" />
                  <input type="hidden" name="id" value={ex.id} />
                  <input type="hidden" name="decision" value="approved" />
                  <button className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                    Approve
                  </button>
                </form>
                <form action={reviewAvailability}>
                  <input type="hidden" name="kind" value="exception" />
                  <input type="hidden" name="id" value={ex.id} />
                  <input type="hidden" name="decision" value="rejected" />
                  <button className="rounded-lg border border-slate-300 bg-card px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                    Decline
                  </button>
                </form>
              </div>
            </div>
          ))}
          {pendingPrefs.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-card px-4 py-3">
              <div>
                <p className="font-medium">{nameById.get(p.employee_id) ?? "Unnamed"}</p>
                <p className="text-sm text-slate-600">
                  Wants to be unavailable every <strong>{DAY_NAMES[p.day_of_week]}</strong>
                </p>
              </div>
              <div className="flex gap-2">
                <form action={reviewAvailability}>
                  <input type="hidden" name="kind" value="weekly" />
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="decision" value="approved" />
                  <button className="rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                    Approve
                  </button>
                </form>
                <form action={reviewAvailability}>
                  <input type="hidden" name="kind" value="weekly" />
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="decision" value="rejected" />
                  <button className="rounded-lg border border-slate-300 bg-card px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                    Decline
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>

        {history.length > 0 && (
          <>
            <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-slate-500">
              History
            </h2>
            <div className="mt-2 space-y-2">
              {history.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-card px-4 py-3"
                >
                  <div>
                    <p className="font-medium">{nameById.get(r.employee_id) ?? "Unnamed"}</p>
                    <p className="text-sm text-slate-600">
                      {leaveLabel(r.category)} · {formatDate(r.start_date)} – {formatDate(r.end_date)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${leaveStatus(r.status).cls}`}
                  >
                    {leaveStatus(r.status).label}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
    </div>
  );
}
