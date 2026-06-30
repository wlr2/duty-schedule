import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { SubmitButton } from "@/components/submit-button";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { inputClass, labelClass } from "@/lib/ui";
import type { LeaveRequest } from "@/lib/types";
import { submitLeave } from "../actions";

function isoDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

const STATUS_STYLES: Record<LeaveRequest["status"], string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700",
};

export default async function LeavePage() {
  const session = await requireProfile();
  const profile = session.profile!;
  const org = profile.organizations!;

  const supabase = await createClient();
  const { data } = await supabase
    .from("leave_requests")
    .select("*")
    .eq("employee_id", session.userId)
    .order("created_at", { ascending: false });

  const requests = (data ?? []) as LeaveRequest[];

  return (
    <>
      <AppHeader orgName={org.name} userName={profile.full_name ?? "You"} role="employee" />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-slate-800">
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Leave &amp; MC</h1>
        <p className="mt-1 text-slate-600">
          Submit a leave or medical certificate request. Your manager is notified
          to approve it.
        </p>

        <form
          action={submitLeave}
          className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5"
        >
          <div>
            <span className={labelClass}>Type</span>
            <div className="mt-1 flex gap-2">
              <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50">
                <input type="radio" name="type" value="leave" defaultChecked />
                Leave
              </label>
              <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50">
                <input type="radio" name="type" value="mc" />
                Medical (MC)
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="start_date">
                From
              </label>
              <input
                id="start_date"
                name="start_date"
                type="date"
                required
                defaultValue={isoDate()}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="end_date">
                To
              </label>
              <input
                id="end_date"
                name="end_date"
                type="date"
                required
                defaultValue={isoDate()}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="reason">
              Reason (optional)
            </label>
            <input
              id="reason"
              name="reason"
              placeholder="e.g. Family event"
              className={inputClass}
            />
          </div>

          <SubmitButton>Submit request</SubmitButton>
        </form>

        <h2 className="mt-8 text-lg font-semibold">Your requests</h2>
        <div className="mt-3 space-y-2">
          {requests.length === 0 && (
            <p className="text-sm text-slate-500">No requests yet.</p>
          )}
          {requests.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
            >
              <div>
                <p className="font-medium">
                  {r.type === "mc" ? "Medical (MC)" : "Leave"} ·{" "}
                  {formatDate(r.start_date)} – {formatDate(r.end_date)}
                </p>
                {r.reason && <p className="text-sm text-slate-500">{r.reason}</p>}
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[r.status]}`}
              >
                {r.status}
              </span>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
