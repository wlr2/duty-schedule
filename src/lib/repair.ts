// ============================================================================
// Addendum A: repair mode — fix coverage gaps with minimal disruption.
// ----------------------------------------------------------------------------
// buildRepairProposal: every CURRENT assignment is hard-locked; the solver
// only fills open slices. The result is saved as a DRAFT schedule_version
// whose `proposal` (jsonb) holds the changes — nothing touches the live
// roster and nobody is notified until the manager publishes.
//
// publishVersion: applies the proposal to `assignments`, stamps publisher +
// timestamp, supersedes the previous published version, and broadcasts
// `schedule_published` to everyone in the org (in-app + browser push).
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { minToTimeStr } from "@/lib/scheduler";
import { defaultSolver } from "@/lib/solver";
import {
  loadSolverInput,
  rowsToEngineAssignments,
  type PeriodLite,
} from "@/lib/schedule-runner";
import { detectGaps } from "@/lib/gap-detector";
import { notifyUsers } from "@/lib/notify";

export interface ProposalFill {
  openAssignmentId: string | null; // existing open row this fill replaces
  positionId: string;
  positionName: string;
  date: string;
  startTime: string;
  endTime: string;
  employeeId: string;
  employeeName: string;
}

export interface ProposalGap {
  date: string;
  positionName: string;
  startTime: string;
  endTime: string;
  missing: number;
  reasons: string[];
}

export interface RepairProposal {
  periodId: string;
  fills: ProposalFill[];
  gaps: ProposalGap[];
  relaxations: { employeeName: string; rule: string; date: string; positionName: string }[];
}

/** Runs the solver in repair mode and stores the outcome as a draft version.
 *  Returns the new version id (or null if the period doesn't exist). */
export async function buildRepairProposal(
  supabase: SupabaseClient,
  orgId: string,
  periodId: string,
): Promise<string | null> {
  const { data: period } = await supabase
    .from("schedule_periods")
    .select("id, start_date, end_date")
    .eq("id", periodId)
    .eq("org_id", orgId)
    .single();
  if (!period) return null;

  const input = await loadSolverInput(supabase, orgId, period as PeriodLite);

  // REPAIR MODE: lock every currently assigned slot (minimal perturbation);
  // the engine then only fills slices that are still uncovered.
  const { data: current } = await supabase
    .from("assignments")
    .select("id, shift_type_id, employee_id, work_date, start_time, end_time, status")
    .eq("period_id", periodId);
  const rows = current ?? [];
  const locked = rowsToEngineAssignments(
    rows.filter((r) => r.employee_id),
    input.posTimeById,
  );

  const result = await defaultSolver.solve({
    dates: input.dates,
    positions: input.positions,
    employees: input.employees,
    locked,
  });

  // Map solver fills onto existing OPEN rows so publishing updates in place.
  const openByKey = new Map(
    rows
      .filter((r) => !r.employee_id)
      .map((r) => [`${r.shift_type_id}|${r.work_date}|${r.start_time}|${r.end_time}`, r.id]),
  );
  const nameOfEmp = new Map(input.employees.map((e) => [e.id, e.name]));
  const nameOfPos = new Map(input.positions.map((p) => [p.id, p.name]));

  const fills: ProposalFill[] = [];
  for (const a of result.assignments) {
    if (!a.employeeId) continue; // unfilled slots are reported as gaps below
    const startTime = minToTimeStr(a.startMin);
    const endTime = minToTimeStr(a.endMin);
    fills.push({
      openAssignmentId:
        openByKey.get(`${a.positionId}|${a.date}|${startTime}|${endTime}`) ?? null,
      positionId: a.positionId,
      positionName: nameOfPos.get(a.positionId) ?? "?",
      date: a.date,
      startTime,
      endTime,
      employeeId: a.employeeId,
      employeeName: nameOfEmp.get(a.employeeId) ?? "?",
    });
  }

  const proposal: RepairProposal = {
    periodId,
    fills,
    gaps: result.gapDetails.map((g) => ({
      date: g.date,
      positionName: g.positionName,
      startTime: minToTimeStr(g.startMin),
      endTime: minToTimeStr(g.endMin),
      missing: g.missing,
      reasons: g.reasons,
    })),
    relaxations: result.relaxations.map((r) => ({
      employeeName: r.employeeName,
      rule: r.rule,
      date: r.date,
      positionName: r.positionName,
    })),
  };

  const { data: nextVersion } = await supabase.rpc("next_schedule_version", { p_org: orgId });
  const { data: version, error } = await supabase
    .from("schedule_versions")
    .insert({
      org_id: orgId,
      period_id: periodId,
      version: nextVersion ?? 1,
      status: "draft",
      note: `Auto-fill repair: ${fills.length} slot(s) filled, ${proposal.gaps.length} still open`,
      proposal,
    })
    .select("id")
    .single();
  if (error || !version) return null;
  return version.id as string;
}

/** Publishes a draft version: applies fills, supersedes the previous
 *  published version, stamps publisher, broadcasts to the whole org. */
export async function publishVersion(
  supabase: SupabaseClient,
  orgId: string,
  versionId: string,
  publisherId: string,
): Promise<boolean> {
  const { data: version } = await supabase
    .from("schedule_versions")
    .select("id, version, status, period_id, proposal")
    .eq("id", versionId)
    .eq("org_id", orgId)
    .single();
  if (!version || version.status !== "draft") return false;
  const proposal = version.proposal as RepairProposal | null;
  if (!proposal) return false;

  // Apply fills: update the open rows in place; insert any fill that has no
  // stored open row (e.g. requirement bands added after generation).
  for (const f of proposal.fills) {
    if (f.openAssignmentId) {
      await supabase
        .from("assignments")
        .update({
          employee_id: f.employeeId,
          status: "scheduled",
          source: "solver",
          schedule_version_id: version.id,
        })
        .eq("id", f.openAssignmentId)
        .eq("org_id", orgId);
    } else {
      await supabase.from("assignments").insert({
        org_id: orgId,
        period_id: proposal.periodId,
        shift_type_id: f.positionId,
        employee_id: f.employeeId,
        work_date: f.date,
        start_time: f.startTime,
        end_time: f.endTime,
        status: "scheduled",
        source: "solver",
        schedule_version_id: version.id,
      });
    }
  }

  // Supersede whatever was published before; stamp this one.
  await supabase
    .from("schedule_versions")
    .update({ status: "superseded" })
    .eq("org_id", orgId)
    .eq("status", "published");
  await supabase
    .from("schedule_versions")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: publisherId,
    })
    .eq("id", version.id);
  await supabase
    .from("schedule_periods")
    .update({ status: "published" })
    .eq("id", proposal.periodId)
    .eq("org_id", orgId);

  // Re-sweep: covered gaps auto-resolve (deduped, so no notification spam).
  const { data: period } = await supabase
    .from("schedule_periods")
    .select("start_date, end_date")
    .eq("id", proposal.periodId)
    .single();
  if (period) {
    try {
      await detectGaps(supabase, orgId, period.start_date, period.end_date);
    } catch {
      /* non-fatal */
    }
  }

  // Broadcast: everyone in the org gets the updated schedule (per spec).
  const { data: members } = await supabase.from("profiles").select("id").eq("org_id", orgId);
  await notifyUsers(
    supabase,
    (members ?? []).map((m) => m.id as string),
    {
      title: "Schedule updated",
      body: `Version ${version.version} of the schedule is now live. Tap to see your shifts.`,
      link: "/dashboard/schedule",
      type: "schedule_published",
      dedupeKey: `schedule_published:${version.id}`,
    },
  );

  return true;
}

/** Discards a draft version (nothing was applied or broadcast). */
export async function discardVersion(
  supabase: SupabaseClient,
  orgId: string,
  versionId: string,
): Promise<void> {
  await supabase
    .from("schedule_versions")
    .delete()
    .eq("id", versionId)
    .eq("org_id", orgId)
    .eq("status", "draft");
}
