import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/format";
import type { CoverageRequest } from "@/lib/types";
import { claimCoverage } from "../actions";

export default async function CoveragePage() {
  const session = await requireProfile();
  const profile = session.profile!;
  const org = profile.organizations!;

  const supabase = await createClient();
  const [{ data: covData }, { data: people }] = await Promise.all([
    supabase
      .from("coverage_requests")
      .select("*")
      .eq("org_id", profile.org_id)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name").eq("org_id", profile.org_id),
  ]);

  const coverage = (covData ?? []) as CoverageRequest[];
  const nameById = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const open = coverage.filter((c) => c.status === "open");
  const resolved = coverage.filter((c) => c.status !== "open");

  function slotLabel(c: CoverageRequest) {
    const when = c.work_date ? formatDate(c.work_date) : "A shift";
    const pos = c.position_label ? ` · ${c.position_label}` : "";
    const time =
      c.start_time && c.end_time
        ? ` (${formatTime(c.start_time)}–${formatTime(c.end_time)})`
        : "";
    return `${when}${pos}${time}`;
  }

  return (
    <>
      <AppHeader orgName={org.name} userName={profile.full_name ?? "You"} role={profile.role} />
      <RealtimeRefresh orgId={profile.org_id!} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft size={15} aria-hidden /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Coverage requests</h1>
        <p className="mt-1 text-slate-600">Open shifts that need someone. Tap to take one.</p>

        <h2 className="mt-6 text-sm font-medium uppercase tracking-wide text-slate-500">
          Open ({open.length})
        </h2>
        <div className="mt-2 space-y-2">
          {open.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-card px-4 py-6 text-sm text-slate-500">
              Nothing needs cover right now.
            </p>
          )}
          {open.map((c) => {
            const mine = c.requester_id === session.userId;
            return (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-card px-4 py-3"
              >
                <div>
                  <p className="font-medium">{slotLabel(c)}</p>
                  <p className="text-sm text-slate-500">
                    Freed by {mine ? "you" : nameById.get(c.requester_id) ?? "someone"}
                    {c.note ? ` · ${c.note}` : ""}
                  </p>
                </div>
                {mine ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                    Waiting for cover
                  </span>
                ) : (
                  <form action={claimCoverage}>
                    <input type="hidden" name="coverage_id" value={c.id} />
                    <button className="rounded-lg bg-violet px-3 py-2 text-sm font-medium text-white hover:bg-violet-soft">
                      I&apos;ll cover this
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>

        {resolved.length > 0 && (
          <>
            <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-slate-500">
              Covered
            </h2>
            <div className="mt-2 space-y-2">
              {resolved.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-card px-4 py-3"
                >
                  <p className="font-medium">{slotLabel(c)}</p>
                  <span className="text-sm text-green-700">
                    Covered by {c.claimed_by ? nameById.get(c.claimed_by) ?? "a teammate" : "—"}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
