// ============================================================================
// Planner analytics pack (server component): relaxation debt, reliability,
// attendance, leave patterns, forward coverage risk, 8-week trend.
// Each block degrades gracefully when its migration hasn't run yet.
// ============================================================================
import { createClient } from "@/lib/supabase/server";
import { addDaysISO, dayOfWeekISO, timeStrToMin, todayISO } from "@/lib/scheduler";
import { formatDate } from "@/lib/format";

const RULE_LABEL: Record<string, string> = {
  rest: "short rest",
  weekly_hours: "over weekly hours",
  consecutive_days: "long streak",
};

function h1dp(min: number): number {
  return Math.round(min / 6) / 10;
}

export async function PlannerSections({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const today = todayISO();
  const d30ago = addDaysISO(today, -30);
  const d56ago = addDaysISO(today, -56); // 8 weeks
  const d14ahead = addDaysISO(today, 14);
  const weekStart = addDaysISO(today, -((dayOfWeekISO(today) + 6) % 7));

  const [staffQ, relaxQ, covQ, attQ, asgQ, leaveQ, gapsQ, memQ, reqQ, posQ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, target_hours_per_week")
      .eq("org_id", orgId)
      .eq("role", "employee"),
    supabase
      .from("relaxations")
      .select("employee_id, rule, work_date")
      .eq("org_id", orgId)
      .gte("work_date", d30ago),
    supabase
      .from("coverage_requests")
      .select("requester_id, claimed_by, status, created_at, resolved_at")
      .eq("org_id", orgId),
    supabase
      .from("attendance")
      .select("employee_id, work_date, scheduled_start, check_in_at")
      .eq("org_id", orgId)
      .gte("work_date", d56ago),
    supabase
      .from("assignments")
      .select("employee_id, work_date, start_time, end_time, status, shift_types(start_time, end_time)")
      .eq("org_id", orgId)
      .gte("work_date", d56ago)
      .lte("work_date", today)
      .not("employee_id", "is", null)
      .neq("status", "open"),
    supabase
      .from("leave_requests")
      .select("employee_id, category, status, start_date, end_date, created_at")
      .eq("org_id", orgId)
      .gte("start_date", d56ago),
    supabase
      .from("coverage_gaps")
      .select("work_date")
      .eq("org_id", orgId)
      .eq("resolved", false)
      .gte("work_date", today)
      .lte("work_date", d14ahead),
    supabase.from("position_members").select("position_id, employee_id").eq("org_id", orgId),
    supabase
      .from("coverage_requirements")
      .select("position_id, min_headcount")
      .eq("org_id", orgId),
    supabase.from("shift_types").select("id, name, required_staff").eq("org_id", orgId),
  ]);

  const staff = (staffQ.data ?? []) as { id: string; full_name: string | null; target_hours_per_week: number }[];
  const nameOf = new Map(staff.map((s) => [s.id, s.full_name ?? "Unnamed"]));

  // ---- Relaxation debt (last 30 days) + consecutive-day streaks -------------
  const relaxRows = (relaxQ.error ? [] : (relaxQ.data ?? [])) as {
    employee_id: string;
    rule: string;
  }[];
  const debt = new Map<string, Record<string, number>>();
  for (const r of relaxRows) {
    const d = debt.get(r.employee_id) ?? {};
    d[r.rule] = (d[r.rule] ?? 0) + 1;
    debt.set(r.employee_id, d);
  }
  // Current worked-day streak per person (from assignments, ending today/yesterday).
  const workedDates = new Map<string, Set<string>>();
  for (const a of (asgQ.data ?? []) as { employee_id: string | null; work_date: string }[]) {
    if (!a.employee_id) continue;
    (workedDates.get(a.employee_id) ?? workedDates.set(a.employee_id, new Set()).get(a.employee_id)!).add(
      a.work_date,
    );
  }
  const streakOf = (id: string): number => {
    const set = workedDates.get(id);
    if (!set) return 0;
    let d = set.has(today) ? today : addDaysISO(today, -1);
    let streak = 0;
    while (set.has(d)) {
      streak++;
      d = addDaysISO(d, -1);
    }
    return streak;
  };
  const debtRows = staff
    .map((s) => {
      const d = debt.get(s.id) ?? {};
      const total = Object.values(d).reduce((x, y) => x + y, 0);
      return { name: nameOf.get(s.id)!, d, total, streak: streakOf(s.id) };
    })
    .filter((r) => r.total > 0 || r.streak >= 5)
    .sort((a, b) => b.total - a.total);

  // ---- Reliability (drop / rescue / median time-to-fill) --------------------
  const cov = (covQ.data ?? []) as {
    requester_id: string;
    claimed_by: string | null;
    status: string;
    created_at: string;
    resolved_at: string | null;
  }[];
  const drops = new Map<string, number>();
  const rescues = new Map<string, number>();
  const fillMins: number[] = [];
  for (const c of cov) {
    drops.set(c.requester_id, (drops.get(c.requester_id) ?? 0) + 1);
    if (c.claimed_by) rescues.set(c.claimed_by, (rescues.get(c.claimed_by) ?? 0) + 1);
    if (c.claimed_by && c.resolved_at) {
      fillMins.push((new Date(c.resolved_at).getTime() - new Date(c.created_at).getTime()) / 60000);
    }
  }
  const medianFill =
    fillMins.length > 0
      ? [...fillMins].sort((a, b) => a - b)[Math.floor(fillMins.length / 2)]
      : null;
  const reliabilityRows = staff
    .map((s) => ({
      name: nameOf.get(s.id)!,
      dropped: drops.get(s.id) ?? 0,
      rescued: rescues.get(s.id) ?? 0,
    }))
    .filter((r) => r.dropped > 0 || r.rescued > 0)
    .sort((a, b) => b.rescued - a.rescued || a.dropped - b.dropped);

  // ---- Attendance: no-show / lateness ---------------------------------------
  const attRows = (attQ.error ? [] : (attQ.data ?? [])) as {
    employee_id: string;
    work_date: string;
    scheduled_start: string | null;
    check_in_at: string | null;
  }[];
  const attendanceStartDate =
    attRows.length > 0 ? attRows.map((a) => a.work_date).sort()[0] : null;
  const attendance = new Map<string, { shifts: number; present: number; late: number }>();
  if (attendanceStartDate) {
    // Distinct scheduled duty-days per person since check-ins began (past only).
    const dutyDays = new Map<string, Set<string>>();
    for (const a of (asgQ.data ?? []) as { employee_id: string | null; work_date: string }[]) {
      if (!a.employee_id || a.work_date < attendanceStartDate || a.work_date >= today) continue;
      (dutyDays.get(a.employee_id) ?? dutyDays.set(a.employee_id, new Set()).get(a.employee_id)!).add(
        a.work_date,
      );
    }
    const checkedDays = new Map<string, Map<string, boolean>>(); // emp -> date -> late?
    for (const a of attRows) {
      if (!a.check_in_at || a.work_date >= today) continue;
      let late = false;
      if (a.scheduled_start) {
        const start = timeStrToMin(a.scheduled_start);
        const t = new Date(a.check_in_at);
        const inMin = t.getHours() * 60 + t.getMinutes();
        late = inMin > start + 10; // 10-minute grace
      }
      const m = checkedDays.get(a.employee_id) ?? new Map<string, boolean>();
      m.set(a.work_date, (m.get(a.work_date) ?? false) || late);
      checkedDays.set(a.employee_id, m);
    }
    for (const [emp, days] of dutyDays) {
      const checked = checkedDays.get(emp) ?? new Map();
      let present = 0;
      let late = 0;
      for (const d of days) {
        if (checked.has(d)) {
          present++;
          if (checked.get(d)) late++;
        }
      }
      attendance.set(emp, { shifts: days.size, present, late });
    }
  }
  const attendanceRows = [...attendance.entries()]
    .map(([id, a]) => ({
      name: nameOf.get(id) ?? "Unnamed",
      ...a,
      noShow: a.shifts - a.present,
      rate: a.shifts > 0 ? Math.round((100 * a.present) / a.shifts) : 100,
    }))
    .sort((a, b) => a.rate - b.rate);

  // ---- Leave patterns (neutral surface) --------------------------------------
  const leaves = (leaveQ.data ?? []) as {
    employee_id: string;
    category: string | null;
    status: string;
    start_date: string;
    end_date: string;
  }[];
  const leavePattern = new Map<string, { mc: number; days: number; monFri: number; adjOff: number }>();
  for (const l of leaves) {
    if (l.status === "rejected") continue;
    const isMC = l.category === "medical" || l.category === null;
    const p =
      leavePattern.get(l.employee_id) ?? { mc: 0, days: 0, monFri: 0, adjOff: 0 };
    if (isMC) p.mc++;
    let d = l.start_date;
    while (d <= l.end_date) {
      p.days++;
      const dow = dayOfWeekISO(d);
      if (dow === 1 || dow === 5) p.monFri++;
      const worked = workedDates.get(l.employee_id);
      const prevOff = !worked?.has(addDaysISO(d, -1));
      const nextOff = !worked?.has(addDaysISO(d, 1));
      if (prevOff || nextOff) p.adjOff++;
      d = addDaysISO(d, 1);
    }
    leavePattern.set(l.employee_id, p);
  }
  const leaveRows = [...leavePattern.entries()]
    .map(([id, p]) => ({
      name: nameOf.get(id) ?? "Unnamed",
      ...p,
      monFriPct: p.days > 0 ? Math.round((100 * p.monFri) / p.days) : 0,
    }))
    .filter((r) => r.days > 0)
    .sort((a, b) => b.mc - a.mc);

  // ---- Forward coverage risk --------------------------------------------------
  const gapsAhead = (gapsQ.data ?? []) as { work_date: string }[];
  const gapsByDate = new Map<string, number>();
  for (const g of gapsAhead) gapsByDate.set(g.work_date, (gapsByDate.get(g.work_date) ?? 0) + 1);
  const leaveAheadByDate = new Map<string, number>();
  for (const l of leaves) {
    if (l.status !== "approved") continue;
    let d = l.start_date < today ? today : l.start_date;
    const end = l.end_date > d14ahead ? d14ahead : l.end_date;
    while (d <= end) {
      leaveAheadByDate.set(d, (leaveAheadByDate.get(d) ?? 0) + 1);
      d = addDaysISO(d, 1);
    }
  }
  const forwardDays: { date: string; gaps: number; onLeave: number }[] = [];
  for (let d = today, i = 0; i < 14; d = addDaysISO(d, 1), i++) {
    forwardDays.push({ date: d, gaps: gapsByDate.get(d) ?? 0, onLeave: leaveAheadByDate.get(d) ?? 0 });
  }
  // Bus factor: eligible pool vs required headcount per position.
  const positions = (posQ.data ?? []) as { id: string; name: string; required_staff: number }[];
  const members = (memQ.data ?? []) as { position_id: string; employee_id: string }[];
  const reqs = (reqQ.data ?? []) as { position_id: string; min_headcount: number }[];
  const busFactor = positions
    .map((p) => {
      const pool = members.filter((m) => m.position_id === p.id).length || staff.length;
      const need = Math.max(
        p.required_staff ?? 1,
        ...reqs.filter((r) => r.position_id === p.id).map((r) => r.min_headcount),
        1,
      );
      return { name: p.name, pool, need, atRisk: pool <= need + 1 };
    })
    .sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || a.pool - b.pool);

  // ---- 8-week hours-vs-target grid --------------------------------------------
  const weeks: string[] = [];
  for (let i = 7; i >= 0; i--) weeks.push(addDaysISO(weekStart, -7 * i));
  const weekHours = new Map<string, Map<string, number>>(); // emp -> weekKey -> min
  for (const a of (asgQ.data ?? []) as unknown as {
    employee_id: string | null;
    work_date: string;
    start_time: string | null;
    end_time: string | null;
    shift_types: { start_time: string; end_time: string } | null;
  }[]) {
    if (!a.employee_id) continue;
    const s = timeStrToMin(a.start_time ?? a.shift_types?.start_time ?? "00:00");
    let e = timeStrToMin(a.end_time ?? a.shift_types?.end_time ?? "00:00");
    if (e <= s) e += 1440;
    const wk = addDaysISO(a.work_date, -((dayOfWeekISO(a.work_date) + 6) % 7));
    const m = weekHours.get(a.employee_id) ?? new Map<string, number>();
    m.set(wk, (m.get(wk) ?? 0) + (e - s));
    weekHours.set(a.employee_id, m);
  }

  return (
    <>
      {/* Relaxation debt */}
      <Sect title="Relaxation debt — who keeps absorbing rule-bends (30 days)">
        {relaxQ.error ? (
          <Note>Run migration 13 to start recording rule-bends.</Note>
        ) : debtRows.length === 0 ? (
          <Note>No rule-bends recorded — nobody is absorbing short rest or overtime.</Note>
        ) : (
          <Table
            head={["Person", "Total", "Breakdown", "Current work streak"]}
            rows={debtRows.map((r) => [
              r.name,
              String(r.total),
              Object.entries(r.d)
                .map(([rule, n]) => `${n}× ${RULE_LABEL[rule] ?? rule}`)
                .join(", ") || "—",
              r.streak >= 5 ? `⚠ ${r.streak} days straight` : `${r.streak} days`,
            ])}
          />
        )}
      </Sect>

      {/* Reliability */}
      <Sect title="Cover reliability — who drops shifts, who rescues them">
        {reliabilityRows.length === 0 ? (
          <Note>No cover requests yet.</Note>
        ) : (
          <>
            <Table
              head={["Person", "Cover requested", "Shifts rescued"]}
              rows={reliabilityRows.map((r) => [r.name, String(r.dropped), String(r.rescued)])}
            />
            {medianFill !== null && (
              <p className="mt-2 text-xs text-slate-500">
                Median time to fill a cover request:{" "}
                <strong>
                  {medianFill >= 60 ? `${Math.round(medianFill / 6) / 10}h` : `${Math.round(medianFill)}m`}
                </strong>
              </p>
            )}
          </>
        )}
      </Sect>

      {/* Attendance */}
      <Sect title="Attendance — actual vs scheduled">
        {attQ.error ? (
          <Note>Run migration 13, then staff check in from “My schedule”.</Note>
        ) : attendanceRows.length === 0 ? (
          <Note>Waiting for the first check-ins — staff tap “Check in” on their shift.</Note>
        ) : (
          <Table
            head={["Person", "Attendance", "Late (>10m)", "No-shows"]}
            rows={attendanceRows.map((r) => [
              r.name,
              `${r.rate}% (${r.present}/${r.shifts})`,
              String(r.late),
              r.noShow > 0 ? `⚠ ${r.noShow}` : "0",
            ])}
          />
        )}
      </Sect>

      {/* Leave patterns */}
      <Sect title="Leave patterns (8 weeks) — a neutral look, not an accusation">
        {leaveRows.length === 0 ? (
          <Note>No leave in the last 8 weeks.</Note>
        ) : (
          <Table
            head={["Person", "MC requests", "Leave days", "On Mon/Fri", "Next to an off-day"]}
            rows={leaveRows.map((r) => [
              r.name,
              String(r.mc),
              String(r.days),
              `${r.monFriPct}%`,
              `${r.days > 0 ? Math.round((100 * r.adjOff) / r.days) : 0}%`,
            ])}
          />
        )}
      </Sect>

      {/* Forward risk */}
      <Sect title="Next 14 days — coverage risk">
        <div className="rounded-[20px] border border-slate-200 bg-card p-4">
          <div className="flex items-end gap-1 overflow-x-auto pb-1">
            {forwardDays.map((d) => (
              <div key={d.date} className="flex w-10 shrink-0 flex-col items-center gap-1">
                <span className={`text-xs font-semibold tabular-nums ${d.gaps > 0 ? "text-red-600" : "text-slate-400"}`}>
                  {d.gaps > 0 ? d.gaps : "·"}
                </span>
                <div
                  className={`w-6 rounded-t ${d.gaps > 0 ? "bg-red-600/70" : "bg-green-100"}`}
                  style={{ height: Math.max(6, Math.min(48, d.gaps * 8)) }}
                  title={`${formatDate(d.date)}: ${d.gaps} open slot(s), ${d.onLeave} on leave`}
                />
                <span className="text-[10px] text-slate-400">{d.date.slice(8)}</span>
                {d.onLeave > 0 && (
                  <span className="rounded bg-amber-50 px-1 text-[9px] text-amber-800">{d.onLeave}🏖</span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Red = unfilled slots that day; amber tag = people on approved leave.
          </p>
        </div>
        {busFactor.length > 0 && (
          <div className="mt-3">
            <Table
              head={["Position", "Eligible people", "Needed at once", "Risk"]}
              rows={busFactor.map((b) => [
                b.name,
                String(b.pool),
                String(b.need),
                b.atRisk ? "⚠ one MC away from a gap" : "OK",
              ])}
            />
          </div>
        )}
      </Sect>

      {/* 8-week trend */}
      <Sect title="Hours vs required — 8-week trend">
        {staff.length === 0 ? (
          <Note>No staff yet.</Note>
        ) : (
          <div className="overflow-x-auto rounded-[20px] border border-slate-200 bg-card">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Person</th>
                  {weeks.map((w) => (
                    <th key={w} className="px-2 py-2 text-center font-medium">
                      {w.slice(5)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Required/wk</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => {
                  const m = weekHours.get(s.id);
                  const target = s.target_hours_per_week ?? 0;
                  return (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-medium">{nameOf.get(s.id)}</td>
                      {weeks.map((w) => {
                        const hrs = h1dp(m?.get(w) ?? 0);
                        const over = target > 0 && hrs > target;
                        const cls =
                          hrs === 0
                            ? "text-slate-400"
                            : over
                              ? "bg-amber-50 font-semibold text-amber-800"
                              : "text-slate-700";
                        return (
                          <td key={w} className={`px-2 py-1.5 text-center tabular-nums ${cls}`}>
                            {hrs || "·"}
                          </td>
                        );
                      })}
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{target}h</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
              Amber cells = more hours that week than required. Weeks run Monday–Sunday.
            </p>
          </div>
        )}
      </Sect>
    </>
  );
}

function Sect({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-slate-200 bg-card px-4 py-5 text-sm text-slate-500">
      {children}
    </p>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-[20px] border border-slate-200 bg-card">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {r.map((c, j) => (
                <td key={j} className={`px-4 py-2 ${j === 0 ? "font-medium" : "text-slate-600"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
