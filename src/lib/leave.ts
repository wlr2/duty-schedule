// Official leave reasons (employees pick one — no free text).
export const LEAVE_REASONS = [
  { value: "medical", label: "Medical" },
  { value: "overseas", label: "Overseas leave" },
  { value: "compassionate", label: "Compassionate leave" },
  { value: "annual", label: "Annual leave" },
  { value: "other", label: "Other" },
] as const;

export type LeaveCategory = (typeof LEAVE_REASONS)[number]["value"];

const LABELS: Record<string, string> = Object.fromEntries(
  LEAVE_REASONS.map((r) => [r.value, r.label]),
);

export function leaveLabel(category: string | null | undefined): string {
  if (!category) return "Leave";
  return LABELS[category] ?? "Leave";
}

export function isLeaveCategory(value: string): value is LeaveCategory {
  return LEAVE_REASONS.some((r) => r.value === value);
}

// How each status reads + looks to staff and managers.
export const LEAVE_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bg-amber-100 text-amber-800" },
  approved: { label: "Confirmed", cls: "bg-green-100 text-green-800" },
  rejected: { label: "Declined", cls: "bg-red-100 text-red-700" },
};

export function leaveStatus(status: string) {
  return LEAVE_STATUS[status] ?? { label: status, cls: "bg-slate-100 text-slate-700" };
}
