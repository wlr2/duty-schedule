import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { SubmitButton } from "@/components/submit-button";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DAY_NAMES } from "@/lib/format";
import type { EmployeePreference, PreferenceLevel } from "@/lib/types";
import { saveAvailability } from "../actions";

const LEVELS: { value: PreferenceLevel; label: string }[] = [
  { value: "preferred", label: "Preferred" },
  { value: "available", label: "Available" },
  { value: "unavailable", label: "Unavailable" },
];

export default async function AvailabilityPage() {
  const session = await requireProfile();
  const profile = session.profile!;
  const org = profile.organizations!;

  const supabase = await createClient();
  const { data } = await supabase
    .from("employee_preferences")
    .select("day_of_week, preference")
    .eq("employee_id", session.userId);

  const prefs = (data ?? []) as Pick<EmployeePreference, "day_of_week" | "preference">[];
  const current = new Map(prefs.map((p) => [p.day_of_week, p.preference]));

  return (
    <>
      <AppHeader orgName={org.name} userName={profile.full_name ?? "You"} role="employee" />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft size={15} aria-hidden /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Weekly availability</h1>
        <p className="mt-1 text-slate-600">
          Set which days you can normally work. The scheduler uses this. To take a
          specific day off, submit a leave request.
        </p>

        <form action={saveAvailability} className="mt-6 space-y-2">
          {DAY_NAMES.map((day, d) => {
            const value = current.get(d) ?? "available";
            return (
              <div
                key={d}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <span className="font-medium">{day}</span>
                <select
                  name={`day_${d}`}
                  defaultValue={value}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                >
                  {LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <div className="pt-2">
            <SubmitButton>Save availability</SubmitButton>
          </div>
        </form>
      </main>
    </>
  );
}
