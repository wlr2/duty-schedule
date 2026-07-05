import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export default async function StaffPage() {
  const session = await requireManager();
  const profile = session.profile!;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, target_hours_per_week")
    .eq("org_id", profile.org_id)
    .eq("role", "employee")
    .order("full_name");

  const staff = (data ?? []) as Pick<
    Profile,
    "id" | "full_name" | "target_hours_per_week"
  >[];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-bold">Team</h1>
      <p className="mt-1 text-slate-600">Tap a person to see their profile, hours, and leave.</p>

      <div className="mt-6 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {staff.length === 0 && (
          <p className="px-4 py-6 text-sm text-slate-500">
            No staff yet — share your join code from the Overview.
          </p>
        )}
        {staff.map((s) => (
          <Link
            key={s.id}
            href={`/manager/staff/${s.id}`}
            className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
          >
            <div>
              <p className="font-medium">{s.full_name ?? "Unnamed"}</p>
              <p className="text-sm text-slate-500">
                Required {s.target_hours_per_week} hrs/week
              </p>
            </div>
            <ChevronRight size={18} className="text-slate-400" aria-hidden />
          </Link>
        ))}
      </div>
    </div>
  );
}
