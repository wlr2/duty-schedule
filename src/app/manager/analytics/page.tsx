import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { timeToHours } from "@/lib/format";
import { LEAVE_REASONS } from "@/lib/leave";
import { addDaysISO, dayOfWeekISO, timeStrToMin, todayISO } from "@/lib/scheduler";
import { buildCoverageSeries, type RequirementBandLite } from "@/lib/coverage-series";
import { CoverageChart, CoverageChartLegend } from "@/components/coverage-chart";
import { FairnessBadge } from "@/components/fairness-badge";
import { VBarChart } from "@/components/vbar-chart";
import type { FairnessSnapshot } from "@/lib/fairness";
import type { LeaveRequest, Profile } from "@/lib/types";
import { PlannerSections } from "./planner-sections";

interface RawA {
  employee_id: string | null;
  work_date?: string;
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
    supabase
      .from("profiles")
      .select("id, full_name, target_hours_per_week")
      .eq("org_id", orgId)
      .eq("role", "employee"),
    supabase
      .from("assignments")
      .select("employee_id, work_date, start_time, end_time, shift_types(start_time, end_time)")
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

  // Latest published period's fairness snapshot (migration 12; may be absent).
  const fairQ = await supabase
    .from("schedule_periods")
    .select("start_date, end_date, fairness, fairness_score")
    .eq("org_id", orgId)
    .eq("status", "published")
    .not("fairness_score", "is", null)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fairPeriod = fairQ.error ? null : fairQ.data;
  const fairSnapshot = (fairPeriod?.fairness ?? null) as FairnessSnapshot | null;

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

  const staff = (staffData ?? []) as Pick<Profile, "id" | "full_name" | "target_hours_per_week">[];
  const nameById = new Map(staff.map((s) => [s.id, s.full_name ?? "Unnamed"]));

  // Hours scheduled per employee (all time + this calendar week).
  const weekStart = addDaysISO(today, -((dayOfWeekISO(today) + 6) % 7)); // Monday
  const weekEnd = addDaysISO(weekStart, 6);
  const hours: Record<string, number> = {};
  const weekHours: Record<string, number> = {};
  for (const s of staff) {
    hours[s.id] = 0;
    weekHours[s.id] = 0;
  }
  for (const a of (assignData ?? []) as unknown as RawA[]) {
    if (!a.employee_id) continue;
    const st = timeToHours(a.start_time ?? a.shift_types?.start_time);
    const en = timeToHours(a.end_time ?? a.shift_types?.end_time);
    if (st == null || en == null || en <= st) continue;
    const len = en - st;
    hours[a.employee_id] = (hours[a.employee_id] ?? 0) + len;
    if (a.work_date && a.work_date >= weekStart && a.work_date <= weekEnd) {
      weekHours[a.employee_id] = (weekHours[a.employee_id] ?? 0) + len;
    }
  }
  const byHours = [...staff]
    .map((s) => ({ label: s.full_name ?? "Unnamed", value: Math.round(hours[s.id] ?? 0) }))
    .sort((a, b) => b.value - a.value);

  // This week vs required hours: spot who is over or under their target.
  const weekVsRequired = [...staff]
    .map((s) => ({
      name: s.full_name ?? "Unnamed",
      scheduled: Math.round((weekHours[s.id] ?? 0) * 10) / 10,
      required: s.target_hours_per_week ?? 0,
    }))
    .sort((a, b) => b.scheduled - a.scheduled);

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
        <div className="mt-6 rounded-[20px] border border-slate-200 bg-card p-5">
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

      <Section title="Hours scheduled">
        {byHours.length === 0 || byHours.every((x) => x.value === 0) ? (
          <Empty>No scheduled hours yet.</Empty>
        ) : (
          <div className="rounded-[20px] border border-slate-200 bg-card p-4">
            <VBarChart items={byHours} suffix="h" />
          </div>
        )}
      </Section>

      <Section title="This week vs required hours">
        {weekVsRequired.length === 0 ? (
          <Empty>No staff yet.</Empty>
        ) : (
          <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-card">
            <p className="border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
              Week of {weekStart} — instantly spot who is over or under their required hours.
            </p>
            {weekVsRequired.map((x) => {
              const pct =
                x.required > 0 ? Math.min(140, Math.round((100 * x.scheduled) / x.required)) : 0;
              const over = x.required > 0 && x.scheduled > x.required;
              return (
                <div
                  key={x.name}
                  className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0"
                >
                  <span className="w-32 shrink-0 truncate text-sm font-medium">{x.name}</span>
                  <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${over ? "bg-gold" : "bg-violet"}`}
                      style={{ width: `${Math.min(100, (pct / 140) * 100)}%`, opacity: 0.9 }}
                    />
                    {x.required > 0 && (
                      <span
                        className="absolute top-0 h-full w-0.5 bg-slate-400"
                        style={{ left: `${(100 / 140) * 100}%` }}
                        title="Required hours"
                      />
                    )}
                  </div>
                  <span className="w-32 shrink-0 text-right text-sm tabular-nums">
                    {x.scheduled}h / {x.required}h
                    {over && (
                      <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        +{Math.round((x.scheduled - x.required) * 10) / 10}h over
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Duty burden &amp; fairness">
        {!fairSnapshot ? (
          <Empty>Publish a schedule to see its fairness score.</Empty>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-[20px] border border-slate-200 bg-card p-4">
              <p className="font-display text-4xl font-bold">
                {fairSnapshot.score ?? "—"}
              </p>
              <div className="min-w-0">
                <FairnessBadge score={fairSnapshot.score} size="lg" />
                <p className="mt-1 text-xs text-slate-500">
                  Latest published schedule ({fairPeriod?.start_date} – {fairPeriod?.end_date}).
                  100 = burden spread perfectly evenly; nights &amp; weekends weigh 1.5–2×.
                </p>
              </div>
            </div>

            <div className="rounded-[20px] border border-slate-200 bg-card p-4">
              <VBarChart
                items={fairSnapshot.people
                  .filter((p) => p.burden > 0)
                  .map((p) => ({ label: p.name, value: Math.round(p.burden / 6) / 10 }))}
                suffix="h"
              />
              <p className="mt-1 text-center text-xs text-slate-400">
                Weighted burden hours per person
              </p>
            </div>

            <div className="overflow-x-auto rounded-[20px] border border-slate-200 bg-card">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Person</th>
                    <th className="px-4 py-2 text-right font-medium">Total h</th>
                    <th className="px-4 py-2 text-right font-medium">Night h</th>
                    <th className="px-4 py-2 text-right font-medium">Weekend h</th>
                    <th className="px-4 py-2 text-right font-medium">Burden share</th>
                  </tr>
                </thead>
                <tbody>
                  {fairSnapshot.people.map((p) => (
                    <tr key={p.employeeId} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium">{p.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {Math.round(p.totalMinutes / 6) / 10}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {Math.round(p.nightMinutes / 6) / 10}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {Math.round(p.weekendMinutes / 6) / 10}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{p.sharePct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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

      <PlannerSections orgId={orgId!} />

      <Section title="Leave taken per person">
        {topLeave.length === 0 ? (
          <Empty>No leave requested yet.</Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-card">
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
  return <p className="rounded-xl border border-slate-200 bg-card px-4 py-6 text-sm text-slate-500">{children}</p>;
}
