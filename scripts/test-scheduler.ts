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

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
