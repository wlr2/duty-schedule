import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { SubmitButton } from "@/components/submit-button";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { LEAVE_REASONS, leaveLabel, leaveStatus } from "@/lib/leave";
import { inputClass, labelClass } from "@/lib/ui";
import type { LeaveRequest } from "@/lib/types";
import { submitLeave } from "../actions";

function isoDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

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
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft size={15} aria-hidden /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Request leave</h1>
        <p className="mt-1 text-slate-600">
          Choose a reason and dates. Your manager is notified to approve it. Once
          approved, any shifts you had are opened for the team to cover.
        </p>

        <form
          action={submitLeave}
          className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5"
        >
          <div>
            <label className={labelClass} htmlFor="category">Reason</label>
            <select id="category" name="category" required defaultValue="" className={inputClass}>
              <option value="" disabled>Select a reason…</option>
              {LEAVE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="start_date">From</label>
              <input id="start_date" name="start_date" type="date" required defaultValue={isoDate()} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="end_date">To</label>
              <input id="end_date" name="end_date" type="date" required defaultValue={isoDate()} className={inputClass} />
            </div>
          </div>

          <SubmitButton>Submit request</SubmitButton>
        </form>

        <h2 className="mt-8 text-lg font-semibold">Your requests</h2>
        <div className="mt-3 space-y-2">
          {requests.length === 0 && <p className="text-sm text-slate-500">No requests yet.</p>}
          {requests.map((r) => {
            const st = leaveStatus(r.status);
            const border =
              r.status === "approved" ? "#16a34a" : r.status === "rejected" ? "#dc2626" : "#f59e0b";
            return (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
                style={{ borderLeft: `4px solid ${border}` }}
              >
                <div>
                  <p className="font-medium">{leaveLabel(r.category)}</p>
                  <p className="text-sm text-slate-500">
                    {formatDate(r.start_date)} – {formatDate(r.end_date)}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>
                  {st.label}
                </span>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
