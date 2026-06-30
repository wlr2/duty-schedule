// Small formatting helpers for times and dates.

/** "09:00:00" or "09:00" -> "9:00 AM" */
export function formatTime(t: string | null | undefined): string {
  if (!t) return "—";
  const [hStr, mStr] = t.split(":");
  let h = Number(hStr);
  const m = mStr ?? "00";
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${period}`;
}

/** Hours between two "HH:MM[:SS]" times; handles overnight shifts. */
export function shiftHours(start: string, end: string): number {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  let diff = toMinutes(end) - toMinutes(start);
  if (diff <= 0) diff += 24 * 60; // crosses midnight
  return Math.round((diff / 60) * 100) / 100;
}

/** "2026-06-30" -> "Tue, Jun 30" */
export function formatDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d + "T00:00:00") : d;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
