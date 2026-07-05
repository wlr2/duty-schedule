// Sanity test for roster-matrix math. Run: npx tsx scripts/test-roster.ts
import {
  buildRosterRows,
  rosterHourColumns,
  rosterHourLabels,
  type RosterDuty,
} from "../src/lib/roster";

const DATE = "2026-07-01";
const duties: RosterDuty[] = [
  { employeeId: "alice", date: DATE, startH: 8, endH: 10, label: "Sentry", color: "#2563eb" },
  { employeeId: "alice", date: DATE, startH: 12, endH: 14, label: "PAC", color: "#0d9488" },
  { employeeId: "alice", date: DATE, startH: 16, endH: 18, label: "VAC", color: "#b45309" },
  { employeeId: "cara", date: DATE, startH: 8, endH: 11, label: "Sentry", color: "#2563eb" },
];
const people = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" }, // no duties -> off
  { id: "cara", name: "Cara" },
];

const hourCols = rosterHourColumns(duties);
const labels = rosterHourLabels(hourCols);
const rows = buildRosterRows({ duties, people, date: DATE, hourCols });

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

const alice = rows.find((r) => r.id === "alice")!;
const bob = rows.find((r) => r.id === "bob")!;
const cara = rows.find((r) => r.id === "cara")!;

check("columns span 08:00-18:00 (10 hours)", hourCols.length === 10);
check("first label is '0800 - 0900'", labels[0] === "0800 - 0900");

check("Alice on duty, total 6", !alice.off && alice.totalHours === 6);
check("Alice has one cell per hour", alice.cells.length === 10);
check("Alice 08:00 = Sentry, labelled", alice.cells[0].label === "Sentry" && alice.cells[0].showLabel);
check("Alice 09:00 = Sentry, not re-labelled", alice.cells[1].label === "Sentry" && !alice.cells[1].showLabel);
check("Alice 10:00 = empty gap", alice.cells[2].label === null);
check("Alice 12:00 = PAC, labelled", alice.cells[4].label === "PAC" && alice.cells[4].showLabel);
check("Alice 16:00 = VAC, labelled", alice.cells[8].label === "VAC" && alice.cells[8].showLabel);

check("Bob is OFF duty", bob.off && bob.totalHours === 0 && bob.cells.length === 0);

check("Cara total 3", cara.totalHours === 3);
check("Cara 08:00 Sentry labelled, 09/10 unlabelled", cara.cells[0].showLabel && !cara.cells[1].showLabel && cara.cells[2].label === "Sentry");
check("Cara 11:00 empty", cara.cells[3].label === null);

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
