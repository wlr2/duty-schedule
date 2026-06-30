import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { requireProfile } from "@/lib/auth";

export default async function EmployeeHome() {
  const session = await requireProfile();
  const profile = session.profile!;
  const org = profile.organizations!;

  return (
    <>
      <AppHeader orgName={org.name} userName={profile.full_name ?? "You"} role="employee" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <h1 className="text-2xl font-bold">Hi {profile.full_name} 👋</h1>
        <p className="mt-1 text-slate-600">Here&apos;s your DutyRoster home.</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <NavCard
            href="/dashboard/schedule"
            icon="📅"
            title="My schedule"
            body="See your upcoming shifts."
          />
          <NavCard
            href="/dashboard/availability"
            icon="⚙️"
            title="My preferences"
            body="Tell us which days you prefer or can't work."
          />
          <NavCard
            href="/dashboard/leave"
            icon="🩺"
            title="Leave & MC"
            body="Submit leave or a medical certificate."
          />
          <NavCard
            href="/dashboard/coverage"
            icon="🔁"
            title="Coverage"
            body="See open cover requests or take a shift."
          />
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="font-semibold">Target hours</h2>
          <p className="mt-1 text-sm text-slate-600">
            Your manager has set your target at{" "}
            <strong>{profile.target_hours_per_week} hours/week</strong>.
          </p>
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
