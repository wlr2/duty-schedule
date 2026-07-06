import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { timeToHours } from "@/lib/format";
import { LEAVE_REASONS } from "@/lib/leave";
import { timeStrToMin, todayISO } from "@/lib/scheduler";
import { buildCoverageSeries, type RequirementBandLite } from "@/lib/coverage-series";
import { CoverageChart, CoverageChartLegend } from "@/components/coverage-chart";
import type { LeaveRequest, Profile } from "@/lib/types";

interface RawA {
  employee_id: string | null;
  start_time: string | null;
  end_time: string | null;
  shift_types: { start_time: string; end_time: string } | null;
}

export default async function AnalyticsPage() {
  const session = await requireManager();
  const orgId = session.profile!.org_id;

  const supabase = await createClient();
  const today = todayISO();
  const [
    { data: staffData },
    { data: assignData },
    { data: leaveData },
    { data: covData },
    { data: todayAssign },
    { data: bandData },
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("org_id", orgId).eq("role", "employee"),
    supabase
      .from("assignments")
      .select("employee_id, start_time, end_time, shift_types(start_time, end_time)")
      .eq("org_id", orgId),
    supabase.from("leave_requests").select("employee_id, category, status").eq("org_id", orgId),
    supabase.from("coverage_requests").select("status").eq("org_id", orgId),
    supabase
      .from("assignments")
      .select("start_time, end_time, status, employee_id, shift_types(start_time, end_time)")
      .eq("org_id", orgId)
      .eq("work_date", today),
    supabase
      .from("coverage_requirements")
      .select("day_of_week, start_time, end_time, min_headcount")
      .eq("org_id", orgId),
  ]);

  // Signature staffed-vs-required chart for today (same component as Overview).
  const todaySeries = buildCoverageSeries(
    today,
    ((todayAssign ?? []) as unknown as RawA[])
      .filter((a) => a.employee_id)
      .map((a) => {
        const s = timeStrToMin(a.start_time ?? a.shift_types?.start_time ?? "00:00");
        let e = timeStrToMin(a.end_time ?? a.shift_types?.end_time ?? "00:00");
        if (e <= s) e += 1440;
        return { s, e };
      }),
    (bandData ?? []) as RequirementBandLite[],
  );

  const staff = (staffData ?? []) as Pick<Profile, "id" | "full_name">[];
  const nameById = new Map(staff.map((s) => [s.id, s.full_name ?? "Unnamed"]));

  // Hours scheduled per employee.
  const hours: Record<string, number> = {};
  for (const s of staff) hours[s.id] = 0;
  for (const a of (assignData ?? []) as unknown as RawA[]) {
    if (!a.employee_id) continue;
    const st = timeToHours(a.start_time ?? a.shift_types?.start_time);
    const en = timeToHours(a.end_time ?? a.shift_types?.end_time);
    if (st != null && en != null && en > st) hours[a.employee_id] = (hours[a.employee_id] ?? 0) + (en - st);
  }
  const byHours = [...staff]
    .map((s) => ({ name: s.full_name ?? "Unnamed", value: Math.round(hours[s.id] ?? 0) }))
    .sort((a, b) => b.value - a.value);
  const maxHours = Math.max(1, ...byHours.map((x) => x.value));

  // Leave: per category, and per employee.
  const leaves = (leaveData ?? []) as Pick<LeaveRequest, "employee_id" | "category" | "status">[];
  const byCategory: Record<string, number> = {};
  const leavePerEmp: Record<string, number> = {};
  for (const l of leaves) {
    const cat = l.category ?? "other";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    leavePerEmp[l.employee_id] = (leavePerEmp[l.employee_id] ?? 0) + 1;
  }
  const maxCat = Math.max(1, ...LEAVE_REASONS.map((r) => byCategory[r.value] ?? 0));
  const topLeave = Object.entries(leavePerEmp)
    .map(([id, value]) => ({ name: nameById.get(id) ?? "—", value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const cov = (covData ?? []) as { status: string }[];
  const openGaps = cov.filter((c) => c.status === "open").length;
  const covered = cov.filter((c) => c.status !== "open").length;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <p className="mt-1 text-slate-600">Who works most, leave patterns, and coverage health.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Metric label="Staff" value={staff.length} />
        <Metric label="Leave requests" value={leaves.length} />
        <Metric label="Gaps covered" value={`${covered} / ${covered + openGaps}`} />
      </div>

      {todaySeries.points.length > 0 && (
        <div className="mt-6 rounded-[20px] border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Coverage today</h2>
            <CoverageChartLegend />
          </div>
          <div className="mt-3">
            <CoverageChart
              points={todaySeries.points}
              startMin={todaySeries.startMin}
              endMin={todaySeries.endMin}
            />
          </div>
        </div>
      )}

      <Section title="Hours scheduled (most worked)">
        {byHours.length === 0 ? (
          <Empty>No scheduled hours yet.</Empty>
        ) : (
          byHours.map((x) => <Bar key={x.name} label={x.name} value={x.value} max={maxHours} suffix="h" />)
        )}
      </Section>

      <Section title="Leave by reason">
        {leaves.length === 0 ? (
          <Empty>No leave requested yet.</Empty>
        ) : (
          LEAVE_REASONS.map((r) => (
            <Bar key={r.value} label={r.label} value={byCategory[r.value] ?? 0} max={maxCat} accent="#7c3aed" />
          ))
        )}
      </Section>

      <Section title="Leave taken per person">
        {topLeave.length === 0 ? (
          <Empty>No leave requested yet.</Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {topLeave.map((x) => (
              <div key={x.name} className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 last:border-0">
                <span className="text-sm font-medium">{x.name}</span>
                <span className="text-sm text-slate-600">{x.value} request{x.value === 1 ? "" : "s"}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl bg-slate-100 p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function Bar({
  label,
  value,
  max,
  suffix = "",
  accent = "#2563eb",
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  accent?: string;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-sm">{label}</span>
      <div className="h-5 flex-1 overflow-hidden rounded bg-slate-100">
        <div className="h-full rounded" style={{ width: `${Math.max(value > 0 ? 6 : 0, pct)}%`, backgroundColor: accent }} />
      </div>
      <span className="w-12 shrink-0 text-right text-sm font-medium tabular-nums">
        {value}
        {suffix}
      </span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">{children}</p>;
}
