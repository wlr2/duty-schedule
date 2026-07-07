import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { StressClient } from "./stress-client";

export default async function StressTestPage() {
  const session = await requireManager();
  const profile = session.profile!;
  const supabase = await createClient();

  const [{ data: periodData }, { data: staffData }] = await Promise.all([
    supabase
      .from("schedule_periods")
      .select("id, start_date, end_date, status")
      .eq("org_id", profile.org_id)
      .in("status", ["draft", "published"])
      .order("start_date", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("org_id", profile.org_id)
      .eq("role", "employee")
      .order("full_name"),
  ]);

  // Default pick = latest published, else latest draft.
  const raw = (periodData ?? []) as { id: string; start_date: string; end_date: string; status: string }[];
  const ordered = [...raw.filter((p) => p.status === "published"), ...raw.filter((p) => p.status !== "published")];
  const periods = ordered.map((p) => ({
    id: p.id,
    start_date: p.start_date,
    end_date: p.end_date,
    label: `${formatDate(p.start_date)} – ${formatDate(p.end_date)} (${p.status})`,
  }));
  const staff = ((staffData ?? []) as { id: string; full_name: string | null }[]).map((s) => ({
    id: s.id,
    name: s.full_name ?? "Unnamed",
  }));

  return (
    <div className="mx-auto w-full max-w-4xl">
      <h1 className="text-2xl font-bold">Stress test</h1>
      <p className="mt-1 text-slate-600">
        Ask &quot;what if someone is away?&quot; — the real scheduler simulates the absence and
        shows exactly what coverage breaks. Simulations never change the live roster.
      </p>

      {periods.length === 0 ? (
        <p className="mt-6 rounded-[20px] border border-slate-200 bg-card px-4 py-8 text-center text-sm text-slate-500">
          No assignments in this period yet — generate a schedule first.
        </p>
      ) : (
        <StressClient periods={periods} staff={staff} />
      )}
    </div>
  );
}
