import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatTime } from "@/lib/format";
import type { RepairProposal } from "@/lib/repair";
import { discardDraftVersion, publishDraftVersion } from "../actions";

const RULE_LABEL: Record<string, string> = {
  weekly_hours: "goes over their weekly hours",
  rest: "gets less rest than preferred",
  consecutive_days: "works more consecutive days than usual",
};

export default async function RepairPreviewPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  const session = await requireManager();
  const profile = session.profile!;
  const supabase = await createClient();

  const { data: version } = await supabase
    .from("schedule_versions")
    .select("id, version, status, note, proposal, created_at")
    .eq("id", versionId)
    .eq("org_id", profile.org_id)
    .single();
  if (!version || !version.proposal) notFound();

  const proposal = version.proposal as RepairProposal;
  const isDraft = version.status === "draft";
  const newFills = proposal.fills.filter((f) => f.openAssignmentId !== null);
  const extraFills = proposal.fills.filter((f) => f.openAssignmentId === null);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-bold">Review proposed fix</h1>
      <p className="mt-1 text-slate-600">
        Version {version.version} · {isDraft ? "draft — nothing is live yet" : version.status}.
        Confirmed shifts stay exactly as they are; only the changes below happen.
      </p>

      {/* Newly filled slots */}
      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold">
            {proposal.fills.length > 0
              ? `${proposal.fills.length} slot(s) get someone assigned`
              : "No slots could be filled"}
          </h2>
        </div>
        {proposal.fills.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Position</th>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-4 py-2 font-medium">Now covered by</th>
              </tr>
            </thead>
            <tbody>
              {[...newFills, ...extraFills].map((f, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2">{formatDate(f.date)}</td>
                  <td className="px-4 py-2">{f.positionName}</td>
                  <td className="px-4 py-2">
                    {formatTime(f.startTime)}–{formatTime(f.endTime)}
                  </td>
                  <td className="px-4 py-2 font-medium text-green-700">
                    <CheckCircle2 size={14} className="mr-1 inline" aria-hidden />
                    {f.employeeName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Rule exceptions the fix needed */}
      {proposal.relaxations.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Heads up — this fix bends {proposal.relaxations.length} rule(s):</p>
          <ul className="mt-1 list-inside list-disc">
            {proposal.relaxations.slice(0, 6).map((r, i) => (
              <li key={i}>
                {r.employeeName} {RULE_LABEL[r.rule] ?? r.rule} on {formatDate(r.date)} (
                {r.positionName})
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Remaining gaps + plain-English reasons */}
      {proposal.gaps.length > 0 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">
            <TriangleAlert size={14} className="mr-1 inline" aria-hidden />
            {proposal.gaps.length} slot(s) still can&apos;t be covered:
          </p>
          <ul className="mt-1 space-y-1.5">
            {proposal.gaps.slice(0, 8).map((g, i) => (
              <li key={i}>
                <span className="font-medium">
                  {formatDate(g.date)} {formatTime(g.startTime)}–{formatTime(g.endTime)}{" "}
                  {g.positionName}:
                </span>{" "}
                {g.reasons.length > 0 ? g.reasons.slice(0, 3).join("; ") : "no one available"}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            Ask the AI assistant for the smallest fix, or adjust availability and try again.
          </p>
        </div>
      )}

      {isDraft && (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <form action={publishDraftVersion}>
            <input type="hidden" name="version_id" value={version.id} />
            <SubmitButton className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700">
              Publish schedule
            </SubmitButton>
          </form>
          <form action={discardDraftVersion}>
            <input type="hidden" name="version_id" value={version.id} />
            <SubmitButton className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100">
              Discard
            </SubmitButton>
          </form>
          <p className="text-xs text-slate-500">
            Publishing notifies everyone in the team of the updated schedule.
          </p>
        </div>
      )}
      {!isDraft && (
        <p className="mt-6 text-sm text-slate-500">
          This version is already {version.status}.{" "}
          <Link href="/manager/coverage" className="underline">
            Back to coverage
          </Link>
        </p>
      )}
    </div>
  );
}
