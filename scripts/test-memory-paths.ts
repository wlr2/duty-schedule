// Path-traversal protection tests for the assistant memory handler.
// Spec (Addendum B): "the memory command handler must reject any path outside
// /memories. Implement and test this before wiring the tool in."
// Run: npx tsx scripts/test-memory-paths.ts
import { validateMemoryPath } from "../src/lib/assistant-memory";

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

// ---- Valid paths ------------------------------------------------------------
check("root /memories", validateMemoryPath("/memories") === "/memories");
check("root with trailing slash", validateMemoryPath("/memories/") === "/memories");
check(
  "simple file",
  validateMemoryPath("/memories/scheduling_conventions.md") ===
    "/memories/scheduling_conventions.md",
);
check("nested file", validateMemoryPath("/memories/people/notes.md") === "/memories/people/notes.md");
check(
  "spaces, dots, dashes in names",
  validateMemoryPath("/memories/manager prefs v2.md") === "/memories/manager prefs v2.md",
);
check("duplicate slashes normalized", validateMemoryPath("/memories//a.md") === "/memories/a.md");

// ---- Paths that MUST be rejected --------------------------------------------
const evil: [string, unknown][] = [
  ["parent traversal", "/memories/../secrets.txt"],
  ["deep traversal", "/memories/a/../../etc/passwd"],
  ["bare traversal", "../../etc/passwd"],
  ["absolute outside", "/etc/passwd"],
  ["prefix trick", "/memoriesX/file.md"],
  ["prefix trick 2", "/memories_evil/file.md"],
  ["relative (no leading slash)", "memories/file.md"],
  ["single dot segment", "/memories/./file.md"],
  ["hidden dotfile", "/memories/.env"],
  ["backslashes", "\\memories\\file.md"],
  ["windows drive", "C:/memories/file.md"],
  ["null byte", "/memories/a\0.md"],
  ["empty string", ""],
  ["non-string (number)", 42],
  ["non-string (object)", { path: "/memories/x" }],
  ["null", null],
  ["overlong path", "/memories/" + "a".repeat(400)],
  ["empty segment via slash-dot", "/memories/../memories/x.md"],
];
for (const [label, p] of evil) {
  check(`rejects ${label}`, validateMemoryPath(p) === null);
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
