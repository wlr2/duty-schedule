// Fairness score unit tests (spec §2.6 criteria 1–4).
// Run: npx tsx scripts/test-fairness.ts
import {
  computeBurdens,
  fairnessScore,
  gini,
  type AssignmentLike,
} from "../src/lib/fairness";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

const names = new Map([
  ["a", "Alice"],
  ["b", "Bob"],
]);
const both = new Set(["a", "b"]);

function row(
  employee_id: string,
  work_date: string,
  start: string,
  end: string,
): AssignmentLike {
  return {
    employee_id,
    work_date,
    start_time: start,
    end_time: end,
    status: "scheduled",
    shift_types: null,
  };
}

// ---- 1. Equal plain-weekday minutes -> 100; one-takes-all -> 0 --------------
{
  const TUE = "2026-07-07";
  const equal = computeBurdens(
    [row("a", TUE, "09:00", "17:00"), row("b", TUE, "09:00", "17:00")],
    names,
    both,
  );
  check("equal split scores 100", fairnessScore(equal.map((p) => p.burden)) === 100);

  const lopsided = computeBurdens([row("a", TUE, "09:00", "17:00")], names, both);
  check("one-takes-all scores 0", fairnessScore(lopsided.map((p) => p.burden)) === 0);
}

// ---- 2. Zero-assignment employee is included with burden 0 ------------------
{
  const people = computeBurdens([row("a", "2026-07-07", "09:00", "17:00")], names, both);
  const bob = people.find((p) => p.employeeId === "b")!;
  check("present-but-unassigned person appears with burden 0", bob.burden === 0);
  const onlyA = computeBurdens([row("a", "2026-07-07", "09:00", "17:00")], names, new Set(["a"]));
  check(
    "excluding the on-leave person removes them from the population",
    onlyA.length === 1 && fairnessScore(onlyA.map((p) => p.burden)) === null,
  );
}

// ---- 3. Weighting: Sat night x2.0, Tue night x1.5, Tue day x1.0 -------------
{
  // 2026-07-11 is a Saturday; 22:00–06:00 spills into Sunday (also weekend).
  const satNight = computeBurdens([row("a", "2026-07-11", "22:00", "06:00")], names, new Set(["a"]));
  check("Saturday 10PM–6AM burden = minutes × 2.0", satNight[0].burden === 480 * 2.0);
  check("  ...all 480 minutes counted as night", satNight[0].nightMinutes === 480);

  // 2026-07-07 is a Tuesday; tail lands on Wednesday (still weekday).
  const tueNight = computeBurdens([row("a", "2026-07-07", "22:00", "06:00")], names, new Set(["a"]));
  check("Tuesday 10PM–6AM burden = minutes × 1.5", tueNight[0].burden === 480 * 1.5);

  const tueDay = computeBurdens([row("a", "2026-07-07", "09:00", "17:00")], names, new Set(["a"]));
  check("Tuesday 9AM–5PM burden = minutes × 1.0", tueDay[0].burden === 480 * 1.0);
}

// ---- 4. Friday-night block books its post-midnight tail as Saturday ---------
{
  // 2026-07-10 is a Friday: 22:00–24:00 = weekday night; 00:00–06:00 = Sat.
  const friNight = computeBurdens([row("a", "2026-07-10", "22:00", "06:00")], names, new Set(["a"]));
  check("Friday overnight books 360 weekend minutes (the Saturday tail)", friNight[0].weekendMinutes === 360);
  // burden = 120×1.5 (Fri night) + 360×2.0 (Sat night) = 900
  check("  ...burden splits at midnight correctly", friNight[0].burden === 120 * 1.5 + 360 * 2.0);
}

// ---- Gini sanity -------------------------------------------------------------
{
  check("gini undefined for n=1", gini([100]) === null);
  check("gini undefined for all-zero", gini([0, 0, 0]) === null);
  check("gini 0 for equal values", gini([5, 5, 5, 5]) === 0);
  const g = gini([0, 0, 0, 100]);
  check("gini rises with concentration", g !== null && g > 0.7);
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
