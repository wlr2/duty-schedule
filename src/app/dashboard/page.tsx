import Link from "next/link";
import { CalendarDays, CalendarOff, Repeat, SlidersHorizontal, type LucideIcon } from "lucide-react";
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
        <h1 className="text-2xl font-bold">Hi {profile.full_name}</h1>
        <p className="mt-1 text-slate-600">Here&apos;s your DutyRoster home.</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NavCard
            href="/dashboard/schedule"
            Icon={CalendarDays}
            title="My schedule"
            body="See your upcoming shifts."
          />
          <NavCard
            href="/dashboard/availability"
            Icon={SlidersHorizontal}
            title="Weekly availability"
            body="Set which days you can work."
          />
          <NavCard
            href="/dashboard/leave"
            Icon={CalendarOff}
            title="Leave"
            body="Request leave and track approval."
          />
          <NavCard
            href="/dashboard/coverage"
            Icon={Repeat}
            title="Coverage"
            body="Take an open shift, or see who covered yours."
          />
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-card p-6">
          <h2 className="font-semibold">Required hours</h2>
          <p className="mt-1 text-sm text-slate-600">
            You&apos;re required to work{" "}
            <strong>{profile.target_hours_per_week} hours per week</strong>.
          </p>
        </div>
      </main>
    </>
  );
}

function NavCard({
  href,
  Icon,
  title,
  body,
}: {
  href: string;
  Icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-slate-200 bg-card p-5 transition hover:border-violet/60 hover:shadow-sm"
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
        <Icon size={20} aria-hidden />
      </span>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{body}</p>
    </Link>
  );
}
