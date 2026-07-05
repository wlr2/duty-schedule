import { RealtimeRefresh } from "@/components/realtime-refresh";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/format";
import type { CoverageRequest } from "@/lib/types";

export default async function ManagerCoveragePage() {
  const session = await requireManager();
  const profile = session.profile!;

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

  function slotLabel(c: CoverageRequest) {
    const when = c.work_date ? formatDate(c.work_date) : "Shift";
    const pos = c.position_label ? ` · ${c.position_label}` : "";
    const time =
      c.start_time && c.end_time ? ` (${formatTime(c.start_time)}–${formatTime(c.end_time)})` : "";
    return `${when}${pos}${time}`;
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <RealtimeRefresh orgId={profile.org_id!} />
        <h1 className="text-2xl font-bold">Coverage &amp; gaps</h1>
        <p className="mt-1 text-slate-600">
          Live log of every open gap and who covered it.{" "}
          {open.length > 0 && (
            <span className="font-medium text-red-600">{open.length} still open.</span>
          )}
        </p>

        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {coverage.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              No coverage activity yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Shift</th>
                  <th className="px-4 py-2 font-medium">Freed by</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">{slotLabel(c)}</td>
                    <td className="px-4 py-2">{nameById.get(c.requester_id) ?? "—"}</td>
                    <td className="px-4 py-2">
                      {c.status === "open" ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          Open
                        </span>
                      ) : (
                        <span className="text-green-700">
                          Covered by {c.claimed_by ? nameById.get(c.claimed_by) ?? "teammate" : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
    </div>
  );
}
