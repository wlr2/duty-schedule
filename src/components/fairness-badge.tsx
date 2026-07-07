// Tinted fairness chip: green >= 90, gold 75-89, red < 75.
export function FairnessBadge({ score, size = "sm" }: { score: number | null; size?: "sm" | "lg" }) {
  if (score === null || score === undefined) return null;
  const cls =
    score >= 90
      ? "bg-green-100 text-green-800"
      : score >= 75
        ? "bg-amber-50 text-amber-800"
        : "bg-red-100 text-red-700";
  return (
    <span
      title="100 = duty burden spread perfectly evenly (nights and weekends weighted heavier)"
      className={`shrink-0 rounded-full font-medium ${cls} ${
        size === "lg" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"
      }`}
    >
      Fairness {Math.round(score)}
    </span>
  );
}
