import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export default async function ManagerHome() {
  const session = await requireManager();
  const profile = session.profile!;
  const org = profile.organizations!;

  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("profiles")
    .select("id, full_name, role, target_hours_per_week")
    .eq("org_id", profile.org_id)
    .order("role", { ascending: true });

  const members = (staff ?? []) as Pick<
    Profile,
    "id" | "full_name" | "role" | "target_hours_per_week"
  >[];
  const employeeCount = members.filter((m) => m.role === "employee").length;

  return (
    <>
      <AppHeader orgName={org.name} userName={profile.full_name ?? "Manager"} role="manager" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <h1 className="text-2xl font-bold">Manager dashboard</h1>
        <p className="mt-1 text-slate-600">Welcome back, {profile.full_name}.</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {/* Join code */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-medium text-slate-500">Team join code</h2>
            <p className="mt-2 font-mono text-3xl font-bold tracking-widest">
              {org.join_code}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Share this code with your staff so they can join the team when they
              sign up.
            </p>
          </div>

          {/* Headcount */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-medium text-slate-500">Team size</h2>
            <p className="mt-2 text-3xl font-bold">{employeeCount}</p>
            <p className="mt-2 text-sm text-slate-600">
              {employeeCount === 0
                ? "No staff have joined yet — share your join code above."
                : `${employeeCount} staff member${employeeCount === 1 ? "" : "s"} joined.`}
            </p>
          </div>
        </div>

        {/* Quick links (built out in the next steps) */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <NavCard
            href="/manager/team"
            icon="👥"
            title="Shifts & hours"
            body="Set shift times and each person's target hours."
          />
          <NavCard
            href="/manager/schedule"
            icon="📅"
            title="Build schedule"
            body="Auto-generate a fair roster, then publish it."
          />
          <NavCard
            href="/manager/leave"
            icon="🩺"
            title="Leave approvals"
            body="Review leave and MC requests from staff."
          />
        </div>

        {/* Team list */}
        <h2 className="mt-10 text-lg font-semibold">Team members</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {members.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">No members yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Target hrs/wk</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="px-4 py-2">{m.full_name ?? "—"}</td>
                    <td className="px-4 py-2 capitalize">{m.role}</td>
                    <td className="px-4 py-2">{m.target_hours_per_week}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  );
}

function NavCard({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-400 hover:shadow-sm"
    >
      <div className="text-2xl">{icon}</div>
      <h3 className="mt-2 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
    </Link>
  );
}
