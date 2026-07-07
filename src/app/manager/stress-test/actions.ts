"use server";

import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runStressSweep, type StressReport } from "@/lib/stress-test";

/** Read-only absence simulation. NO revalidatePath — nothing changed. */
export async function runStress(input: {
  periodId: string;
  absentIds?: string[];
  fromDate?: string;
  toDate?: string;
}): Promise<StressReport | { error: string }> {
  const session = await requireManager();
  const orgId = session.profile!.org_id!;
  if (!input.periodId) return { error: "Pick a schedule first." };

  const supabase = await createClient();
  const { data: period } = await supabase
    .from("schedule_periods")
    .select("id, start_date, end_date")
    .eq("id", input.periodId)
    .eq("org_id", orgId)
    .single();
  if (!period) return { error: "Schedule not found." };

  const scenarios =
    input.absentIds && input.absentIds.length > 0
      ? [
          {
            absentIds: input.absentIds.slice(0, 2), // pairs max in v1
            fromDate: input.fromDate || period.start_date,
            toDate: input.toDate || period.end_date,
          },
        ]
      : undefined; // full one-person sweep

  try {
    return await runStressSweep(supabase, orgId, period, { scenarios });
  } catch (err) {
    console.error("Stress test failed:", err);
    return { error: "The simulation hit an error — try again." };
  }
}
