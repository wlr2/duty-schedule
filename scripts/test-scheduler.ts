// Tests for the coverage-first engine. Run: npx tsx scripts/test-scheduler.ts
import {
  generateCoverageSchedule,
  timeStrToMin,
  type EngineEmployee,
  type EnginePosition,
} from "../src/lib/scheduler";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

function emp(id: string, opts: Partial<EngineEmployee> = {}): EngineEmployee {
  return {
    id,
    name: id,
    availabilityByDow: opts.availabilityByDow ?? {},
    unavailableDates: opts.unavailableDates ?? new Set(),
    maxMinutesPerDay: opts.maxMinutesPerDay ?? 16 * 60,
  };
}

function pos(
  id: string,
  start: string,
  end: string,
  headcount: number,
  blockMinutes: number,
  minRestMinutes: number,
  eligible: Set<string> | null = null,
): EnginePosition {
  return {
    id, name: id, color: "#000",
    startMin: timeStrToMin(start), endMin: timeStrToMin(end),
    headcount, blockMinutes, minRestMinutes, eligible,
  };
}

const DATE = "2026-07-01";

// helper: is the position covered (>=headcount) at every minute of its window?
function fullyCovered(r: ReturnType<typeof generateCoverageSchedule>, positionId: string) {
  return r.assignments.filter((a) => a.positionId === positionId).every((a) => a.employeeId !== null);
}

// ---- 1. Guard rotation with enough people -> rest IS respected -------------
{
  const positions = [
    pos("Sentry", "08:00", "14:00", 1, 120, 120),
    pos("PAC", "08:00", "14:00", 1, 120, 120),
    pos("VAC", "08:00", "14:00", 1, 120, 120),
  ];
  const employees = ["A", "B", "C", "D", "E", "F"].map((id) => emp(id));
  const r = generateCoverageSchedule({ dates: [DATE], positions, employees });

  check("guard: no gaps", r.gaps === 0);
  const byBlock: Record<number, string[]> = {};
  for (const a of r.assignments) if (a.employeeId) (byBlock[a.startMin] ??= []).push(a.employeeId);
  check("guard: nobody mans two posts at once", Object.values(byBlock).every((ids) => new Set(ids).size === ids.length));
  const ivs: Record<string, number[][]> = {};
  for (const a of r.assignments) if (a.employeeId) (ivs[a.employeeId] ??= []).push([a.startMin, a.endMin]);
  let restOk = true;
  for (const list of Object.values(ivs)) {
    list.sort((x, y) => x[0] - y[0]);
    for (let i = 1; i < list.length; i++) if (list[i][0] - list[i - 1][1] < 120) restOk = false;
  }
  check("guard: rest respected when enough staff", restOk);
}

// ---- 2. THE KITCHEN BUG: 1 cleaner needed, only 1 eligible ----------------
//     There must ALWAYS be a cleaner on duty — never a midday hole.
{
  const positions = [pos("Cleaner", "08:00", "13:00", 1, 120, 120, new Set(["solo"]))];
  const employees = [emp("solo"), emp("other")]; // 'other' not eligible
  const r = generateCoverageSchedule({ dates: [DATE], positions, employees });

  check("kitchen: ZERO gaps — always 1 cleaner on duty", r.gaps === 0);
  check("kitchen: every block covered (no 5h hole)", fullyCovered(r, "Cleaner"));
  check("kitchen: only the eligible cleaner is used", r.assignments.every((a) => a.employeeId === "solo"));
}

// ---- 3. Restaurant: role eligibility, continuous shift ---------------------
{
  const dishwashers = new Set(["d1", "d2", "d3", "d4", "d5"]);
  const positions = [pos("Dishwasher", "11:00", "19:00", 3, 0, 0, dishwashers)];
  const employees = [...["d1", "d2", "d3", "d4", "d5"], "s1", "s2"].map((id) => emp(id));
  const r = generateCoverageSchedule({ dates: [DATE], positions, employees });

  check("restaurant: 3 staffed, no gaps", r.gaps === 0 && r.assignments.length === 3);
  check("restaurant: only dishwashers used", r.assignments.every((a) => a.employeeId && dishwashers.has(a.employeeId)));
}

// ---- 4. A genuine impossibility surfaces a gap -----------------------------
//     2 posts needed at the same time, only 1 person -> 1 unavoidable gap.
{
  const positions = [
    pos("Front", "08:00", "10:00", 1, 0, 0),
    pos("Back", "08:00", "10:00", 1, 0, 0),
  ];
  const r = generateCoverageSchedule({ dates: [DATE], positions, employees: [emp("only")] });
  check("impossible: 1 person can't cover 2 posts at once -> 1 gap", r.gaps === 1);
  check("impossible: that person is used (not idle)", r.assignments.some((a) => a.employeeId === "only"));
}

// ============================================================================
// Phase 3 solver additions
// ============================================================================

// ---- 5. Requirement bands: 2 by day, 1 overnight ---------------------------
{
  const p = pos("Desk", "08:00", "20:00", 2, 0, 0);
  p.bands = [
    { dayOfWeek: null, startMin: timeStrToMin("08:00"), endMin: timeStrToMin("20:00"), minHeadcount: 2 },
    { dayOfWeek: null, startMin: timeStrToMin("20:00"), endMin: timeStrToMin("08:00"), minHeadcount: 1 }, // crosses midnight
  ];
  const employees = ["A", "B", "C", "D"].map((id) => emp(id));
  const r = generateCoverageSchedule({ dates: [DATE], positions: [p], employees });
  const day = r.assignments.filter((a) => a.startMin === timeStrToMin("08:00"));
  const night = r.assignments.filter((a) => a.startMin === timeStrToMin("20:00"));
  check("bands: day band staffed by 2", day.length === 2 && day.every((a) => a.employeeId));
  check("bands: overnight band staffed by 1", night.length === 1 && night[0].employeeId !== null);
  check("bands: overnight end wraps past midnight", night[0].endMin === timeStrToMin("08:00") + 1440);
  check("bands: no gaps", r.gaps === 0);
}

// ---- 6. Fairness: hours spread evenly over multiple days -------------------
{
  const positions = [pos("Post", "08:00", "20:00", 1, 120, 0)];
  const employees = ["A", "B", "C", "D"].map((id) => emp(id));
  const r = generateCoverageSchedule({ dates: ["2026-07-01", "2026-07-02"], positions, employees });
  const mins = Object.values(r.minutesByEmployee);
  check("fairness: no gaps", r.gaps === 0);
  check(
    "fairness: hours spread within one block (max-min <= 120)",
    Math.max(...mins) - Math.min(...mins) <= 120,
  );
}

// ---- 7. Max consecutive days is honoured when alternatives exist -----------
{
  const positions = [pos("Shop", "09:00", "17:00", 1, 0, 0)];
  const employees = ["A", "B"].map((id) => {
    const e = emp(id);
    e.maxConsecutiveDays = 2;
    return e;
  });
  const dates = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"];
  const r = generateCoverageSchedule({ dates, positions, employees });
  check("consecutive: no gaps", r.gaps === 0);
  const worked: Record<string, string[]> = {};
  for (const a of r.assignments) if (a.employeeId) (worked[a.employeeId] ??= []).push(a.date);
  let maxStreak = 0;
  for (const ds of Object.values(worked)) {
    ds.sort();
    let streak = 1;
    for (let i = 1; i < ds.length; i++) {
      const prev = new Date(ds[i - 1] + "T00:00:00");
      prev.setDate(prev.getDate() + 1);
      streak = prev.toISOString().slice(0, 10) === ds[i] ? streak + 1 : 1;
      maxStreak = Math.max(maxStreak, streak);
    }
  }
  check("consecutive: nobody works 3 days straight", maxStreak <= 2);
}

// ---- 8. Coverage still beats personal rest (relaxation is RECORDED) --------
{
  const positions = [pos("Line", "08:00", "16:00", 1, 120, 0)];
  const employees = ["A", "B"].map((id) => {
    const e = emp(id);
    e.minRestMinutes = 240; // impossible with only 2 people on 2h blocks
    return e;
  });
  const r = generateCoverageSchedule({ dates: [DATE], positions, employees });
  check("relax: zero gaps despite impossible personal rest", r.gaps === 0);
  check("relax: rest relaxations were recorded", r.relaxations.some((x) => x.rule === "rest"));
}

// ---- 9. Approved leave is a hard absence + shows up in gap reasons ---------
{
  const positions = [pos("Solo", "08:00", "12:00", 1, 0, 0, new Set(["only"]))];
  const e = emp("only");
  e.leaveDates = new Set([DATE]);
  const r = generateCoverageSchedule({ dates: [DATE], positions, employees: [e] });
  check("leave: slot becomes a gap", r.gaps === 1);
  check(
    "leave: diagnostic says why",
    r.gapDetails.length === 1 && r.gapDetails[0].reasons.some((x) => x.includes("approved leave")),
  );
}

// ---- 10. Locked assignments survive and count toward coverage --------------
{
  const positions = [pos("Gate", "08:00", "12:00", 1, 0, 0)];
  const employees = ["A", "B"].map((id) => emp(id));
  const r = generateCoverageSchedule({
    dates: [DATE],
    positions,
    employees,
    locked: [
      { date: DATE, positionId: "Gate", employeeId: "A", startMin: timeStrToMin("08:00"), endMin: timeStrToMin("12:00") },
    ],
  });
  check("locked: covered slot not re-emitted", r.assignments.length === 0);
  check("locked: no gaps", r.gaps === 0);
  check("locked: locked minutes count toward fairness", r.minutesByEmployee["A"] === 240);
}

// ---- 11. Night duty spread across staff -------------------------------------
{
  const p = pos("Watch", "22:00", "23:00", 1, 0, 0);
  const employees = ["A", "B", "C", "D"].map((id) => emp(id));
  const dates = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"];
  const r = generateCoverageSchedule({ dates, positions: [p], employees });
  const assignees = new Set(r.assignments.filter((a) => a.employeeId).map((a) => a.employeeId));
  check("night: 4 nights rotate across all 4 people", assignees.size === 4);
}

// ---- 12. REPAIR SPREAD: an absent person's blocks split across the team ----
//      (the "Jun Hao takes all 3" bug: when every candidate is equally tired,
//      continuity used to chain one person through every freed slot).
{
  const positions = [pos("Watchpost", "08:00", "14:00", 1, 120, 600)]; // rest rule bites
  const employees = ["h1", "h2", "h3"].map((id) => emp(id));
  // Everyone already worked a locked early block -> equal day minutes, and
  // every further block violates the 10h rest rule for all of them equally.
  const locked = ["h1", "h2", "h3"].map((id) => ({
    date: DATE,
    positionId: "EarlyTask",
    employeeId: id,
    startMin: timeStrToMin("06:00"),
    endMin: timeStrToMin("07:00"),
  }));
  const r = generateCoverageSchedule({ dates: [DATE], positions, employees, locked });
  const who = r.assignments.filter((a) => a.employeeId).map((a) => a.employeeId);
  check("spread: all 3 freed blocks are covered", r.gaps === 0 && who.length === 3);
  check(
    "spread: blocks split across 3 people (not chained onto one)",
    new Set(who).size === 3,
  );
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
