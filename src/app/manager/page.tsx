import Link from "next/link";
import { CalendarOff, Repeat, Users, type LucideIcon } from "lucide-react";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { timeStrToMin, todayISO } from "@/lib/scheduler";
import { buildCoverageSeries, type RequirementBandLite } from "@/lib/coverage-series";
import { formatTime } from "@/lib/format";
import { CoverageChart, CoverageChartLegend } from "@/components/coverage-chart";
import { Avatar, AvatarCluster } from "@/components/avatar-cluster";

interface TodayRow {
  employee_id: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
  profiles: { full_name: string | null } | null;
  shift_types: { name: string; color: string; start_time: string; end_time: string } | null;
}

export default async function ManagerHome() {
  const session = await requireManager();
  const profile = session.profile!;
  const org = profile.organizations!;
  const supabase = await createClient();

  const today = todayISO();
  const monthStart = today.slice(0, 8) + "01";
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const [
    { count: staffCount },
    { count: pendingLeave },
    { count: openGaps },
    { data: todayData },
    { data: leaveData },
    { data: bandData },
    { count: monthTotal },
    { count: monthOpen },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .eq("role", "employee"),
    supabase
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .eq("status", "pending"),
    supabase
      .from("coverage_gaps")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .eq("resolved", false)
      .gte("work_date", today),
    supabase
      .from("assignments")
      .select(
        "employee_id, start_time, end_time, status, profiles(full_name), shift_types(name, color, start_time, end_time)",
      )
      .eq("org_id", profile.org_id)
      .eq("work_date", today)
      .order("start_time"),
    supabase
      .from("leave_requests")
      .select("employee_id, category, end_date, profiles!leave_requests_employee_id_fkey(full_name)")
      .eq("org_id", profile.org_id)
      .eq("status", "approved")
      .lte("start_date", today)
      .gte("end_date", today),
    supabase
      .from("coverage_requirements")
      .select("day_of_week, start_time, end_time, min_headcount")
      .eq("org_id", profile.org_id),
    supabase
      .from("assignments")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .gte("work_date", monthStart),
    supabase
      .from("assignments")
      .select("id", { count: "exact", head: true })
      .eq("org_id", profile.org_id)
      .gte("work_date", monthStart)
      .eq("status", "open"),
  ]);

  const rows = (todayData ?? []) as unknown as TodayRow[];
  const filled = rows.filter((r) => r.employee_id && r.status !== "open");

  const intervalOf = (r: TodayRow) => {
    const s = timeStrToMin(r.start_time ?? r.shift_types?.start_time ?? "00:00");
    let e = timeStrToMin(r.end_time ?? r.shift_types?.end_time ?? "00:00");
    if (e <= s) e += 1440;
    return { s, e };
  };

  // Who is on duty right now / starting later today.
  const onDutyNow = filled.filter((r) => {
    const { s, e } = intervalOf(r);
    return s <= nowMin && e > nowMin;
  });
  const startingSoon = filled
    .filter((r) => intervalOf(r).s > nowMin)
    .sort((a, b) => intervalOf(a).s - intervalOf(b).s)
    .slice(0, 6);

  const onLeave = (leaveData ?? []) as unknown as {
    category: string | null;
    end_date: string;
    profiles: { full_name: string | null } | null;
  }[];

  // Signature chart: staffed vs required across today.
  const series = buildCoverageSeries(
    today,
    filled.map(intervalOf),
    (bandData ?? []) as RequirementBandLite[],
  );

  const fillRate =
    (monthTotal ?? 0) > 0
      ? Math.round((100 * ((monthTotal ?? 0) - (monthOpen ?? 0))) / (monthTotal ?? 1))
      : null;

  const dutyNames = [...new Set(onDutyNow.map((r) => r.profiles?.full_name ?? "?"))];

  return (
    <div className="mx-auto w-full max-w-6xl fade-in">
      {/* Status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="mt-0.5 text-sm text-slate-500">Welcome back, {profile.full_name}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-card py-1.5 pl-2 pr-3.5 text-sm">
            <AvatarCluster names={dutyNames.length > 0 ? dutyNames : ["–"]} />
            <span className="font-medium">
              {dutyNames.length} of {staffCount ?? 0}
            </span>
            <span className="text-slate-500">on duty</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-card px-3.5 py-1.5 text-sm">
            <span className="font-medium">{onLeave.length}</span>
            <span className="text-slate-500">on leave</span>
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {/* Left column: chart + on duty now */}
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-[20px] border border-slate-200 bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Coverage today</h2>
              <CoverageChartLegend />
            </div>
            {series.points.length > 0 ? (
              <div className="mt-3">
                <CoverageChart
                  points={series.points}
                  startMin={series.startMin}
                  endMin={series.endMin}
                />
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                No shifts scheduled today —{" "}
                <Link href="/manager/schedule" className="text-blue-600 underline">
                  build a schedule
                </Link>
              </p>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold">On duty now</h2>
            {onDutyNow.length === 0 ? (
              <p className="mt-2 rounded-[20px] border border-slate-200 bg-card px-4 py-6 text-center text-sm text-slate-500">
                Nobody is on duty at this hour.
              </p>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {onDutyNow.map((r, i) => {
                  const { s, e } = intervalOf(r);
                  const name = r.profiles?.full_name ?? "?";
                  const personDots = filled.filter((x) => x.profiles?.full_name === name);
                  return (
                    <div key={i} className="rounded-[20px] border border-slate-200 bg-card p-4">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={name} size={34} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{name}</p>
                          <p className="truncate text-xs text-slate-500">
                            {r.shift_types?.name ?? "On duty"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                          {formatTime(r.start_time ?? "")}–{formatTime(r.end_time ?? "")}
                        </span>
                        <span className="text-xs text-slate-500">{(e - s) / 60}h block</span>
                      </div>
                      {/* dot strip: their whole day, colored by position */}
                      <div className="mt-3 flex flex-wrap gap-1">
                        {personDots.map((d, j) => (
                          <span
                            key={j}
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: d.shift_types?.color ?? "#7c5cff" }}
                            title={`${d.shift_types?.name} ${formatTime(d.start_time ?? "")}`}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Quick links */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat href="/manager/staff" Icon={Users} label="Team" value={staffCount ?? 0} sub="staff" />
            <Stat
              href="/manager/leave"
              Icon={CalendarOff}
              label="Pending leave"
              value={pendingLeave ?? 0}
              sub="to review"
              alert={(pendingLeave ?? 0) > 0}
            />
            <Stat
              href="/manager/coverage/fix"
              Icon={Repeat}
              label="Open gaps"
              value={openGaps ?? 0}
              sub="need cover"
              alert={(openGaps ?? 0) > 0}
            />
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          <section className="bg-grad-hero glow-violet rounded-[20px] p-5 text-white">
            <p className="text-xs font-medium uppercase tracking-wide text-white/80">
              Coverage this month
            </p>
            <p className="font-display mt-1 text-5xl font-bold">
              {fillRate !== null ? `${fillRate}%` : "—"}
            </p>
            <p className="mt-1 text-sm text-white/85">
              {fillRate !== null
                ? "of required slots have someone assigned"
                : "no schedule yet this month"}
            </p>
          </section>

          <section className="rounded-[20px] border border-slate-200 bg-card p-4">
            <h2 className="font-semibold">Starting soon</h2>
            <ul className="mt-2 space-y-2">
              {startingSoon.length === 0 && (
                <li className="text-sm text-slate-500">No more starts today.</li>
              )}
              {startingSoon.map((r, i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <Avatar name={r.profiles?.full_name ?? "?"} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {r.profiles?.full_name ?? "?"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {formatTime(r.start_time ?? "")}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[20px] border border-slate-200 bg-card p-4">
            <h2 className="font-semibold">On leave</h2>
            <ul className="mt-2 space-y-2">
              {onLeave.length === 0 && <li className="text-sm text-slate-500">Nobody today.</li>}
              {onLeave.map((l, i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <Avatar name={l.profiles?.full_name ?? "?"} size={28} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {l.profiles?.full_name ?? "?"}
                  </span>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs capitalize text-amber-800">
                    {l.category ?? "leave"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[20px] border border-slate-200 bg-card p-4">
            <h2 className="text-sm font-medium text-slate-500">Team join code</h2>
            <p className="mt-1.5 font-mono text-2xl font-bold tracking-widest">{org.join_code}</p>
            <p className="mt-1 text-xs text-slate-500">
              Share with staff so they can join {org.name}.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({
  href,
  Icon,
  label,
  value,
  sub,
  alert,
}: {
  href: string;
  Icon: LucideIcon;
  label: string;
  value: number;
  sub: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-[20px] border bg-card p-4 transition ${
        alert ? "border-amber-300" : "border-slate-200 hover:border-violet/60"
      }`}
    >
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Icon size={16} /> {label}
      </div>
      <p className="font-display mt-1.5 text-3xl font-bold">{value}</p>
      <p className="text-sm text-slate-500">{sub}</p>
    </Link>
  );
}
