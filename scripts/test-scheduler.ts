// Standalone sanity test for the scheduling engine. Run: npx tsx scripts/test-scheduler.ts
import { generateSchedule, type SchedulerEmployee } from "../src/lib/scheduler";

function emp(
  id: string,
  target: number,
  opts: Partial<SchedulerEmployee> = {},
): SchedulerEmployee {
  return {
    id,
    full_name: id,
    target_hours_per_week: target,
    availability: opts.availability ?? {},
    unavailableDates: opts.unavailableDates ?? new Set(),
  };
}

const shifts = [
  { id: "morning", name: "Morning", start_time: "09:00", end_time: "17:00", required_staff: 1 },
  { id: "evening", name: "Evening", start_time: "17:00", end_time: "22:00", required_staff: 1 },
];

const employees: SchedulerEmployee[] = [
  emp("Alice", 40),
  emp("Bob", 40, { availability: { 0: "unavailable", 6: "unavailable" } }), // no weekends
  emp("Cara", 20, { unavailableDates: new Set(["2026-07-03"]) }), // leave on Jul 3
];

const result = generateSchedule({
  startDate: "2026-06-29", // Mon
  endDate: "2026-07-05", // Sun (7 days)
  shifts,
  employees,
});

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

// 1. No employee works two shifts on the same day.
const perDay: Record<string, string[]> = {};
for (const a of result.assignments) {
  if (!a.employee_id) continue;
  (perDay[a.work_date] ??= []).push(a.employee_id);
}
const noDouble = Object.values(perDay).every(
  (ids) => new Set(ids).size === ids.length,
);
check("no double-booking on any day", noDouble);

// 2. Bob never scheduled on a weekend.
const bobWeekend = result.assignments.some(
  (a) =>
    a.employee_id === "Bob" &&
    [0, 6].includes(new Date(a.work_date + "T00:00:00").getDay()),
);
check("Bob never scheduled on weekends (unavailable)", !bobWeekend);

// 3. Cara never scheduled on her leave date.
const caraLeave = result.assignments.some(
  (a) => a.employee_id === "Cara" && a.work_date === "2026-07-03",
);
check("Cara never scheduled on approved leave date", !caraLeave);

// 4. Hours roughly track targets (Cara, target 20, should be lowest).
const h = result.hoursByEmployee;
console.log("  hours:", h, " openSlots:", result.openSlots);
check("Cara (20h target) <= Alice (40h target)", h["Cara"] <= h["Alice"]);

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
