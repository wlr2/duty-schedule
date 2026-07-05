import Link from "next/link";
import { CalendarOff, Repeat, Users, type LucideIcon } from "lucide-react";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function ManagerHome() {
  const session = await requireManager();
  const profile = session.profile!;
  const org = profile.organizations!;

  const supabase = await createClient();
  const [{ count: staffCount }, { count: pendingLeave }, { count: openGaps }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("org_id", profile.org_id)
        .eq("role", "employee"),
      supabase
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("org_id", profile.org_id)
        .eq("status", "pending"),
      supabase
        .from("coverage_requests")
        .select("id", { count: "exact", head: true })
        .eq("org_id", profile.org_id)
        .eq("status", "open"),
    ]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <h1 className="text-2xl font-bold">Overview</h1>
      <p className="mt-1 text-slate-600">Welcome back, {profile.full_name}.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat href="/manager/staff" Icon={Users} label="Team" value={staffCount ?? 0} sub="staff" />
        <Stat
          href="/manager/leave"
          Icon={CalendarOff}
          label="Pending leave"
          value={pendingLeave ?? 0}
          sub="to review"
          alert={(pendingLeave ?? 0) > 0}
        />
        <Stat
          href="/manager/coverage"
          Icon={Repeat}
          label="Open gaps"
          value={openGaps ?? 0}
          sub="need cover"
          alert={(openGaps ?? 0) > 0}
        />
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-medium text-slate-500">Team join code</h2>
        <p className="mt-2 font-mono text-3xl font-bold tracking-widest">{org.join_code}</p>
        <p className="mt-2 text-sm text-slate-600">
          Share this with staff so they can join {org.name} when they sign up.
        </p>
      </div>

      <p className="mt-6 text-sm text-slate-500">
        Set up <Link href="/manager/team" className="font-medium text-slate-900 underline">positions</Link>,
        then <Link href="/manager/schedule" className="font-medium text-slate-900 underline">build a schedule</Link>.
      </p>
    </div>
  );
}

function Stat({
  href,
  Icon,
  label,
  value,
  sub,
  alert,
}: {
  href: string;
  Icon: LucideIcon;
  label: string;
  value: number;
  sub: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-2xl border bg-white p-5 transition hover:shadow-sm ${
        alert ? "border-amber-300" : "border-slate-200 hover:border-slate-400"
      }`}
    >
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Icon size={16} /> {label}
      </div>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      <p className="text-sm text-slate-500">{sub}</p>
    </Link>
  );
}
