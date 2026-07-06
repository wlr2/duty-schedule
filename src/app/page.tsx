import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, Repeat, Settings, Stethoscope } from "lucide-react";
import { getSession } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Logo } from "@/components/logo";

export default async function Home() {
  // Once connected and signed in, send people straight to their dashboard.
  if (isSupabaseConfigured) {
    const session = await getSession();
    if (session?.profile?.org_id) {
      redirect(session.profile.role === "manager" ? "/manager" : "/dashboard");
    }
  }

  return (
    <main className="flex-1">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 font-semibold">
          <Logo size={32} />
          DutyRoster
        </div>
        {isSupabaseConfigured && (
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/login" className="px-3 py-2 text-slate-600 hover:text-slate-900">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-violet px-4 py-2 font-medium text-white hover:bg-violet-soft"
            >
              Get started
            </Link>
          </nav>
        )}
      </header>

      <section className="mx-auto max-w-5xl px-6 pt-10 pb-16 text-center">
        <h1 className="mx-auto max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          Duty scheduling that runs itself
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600">
          Set everyone&apos;s hours and preferences once. DutyRoster builds a fair
          roster automatically, handles leave and MC approvals, and lets staff
          request cover in a tap — with notifications to everyone who matters.
        </p>

        {isSupabaseConfigured ? (
          <div className="mt-8 flex justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-violet px-6 py-3 font-medium text-white hover:bg-violet-soft"
            >
              Create your team
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-slate-300 bg-white px-6 py-3 font-medium hover:bg-slate-100"
            >
              Log in
            </Link>
          </div>
        ) : (
          <SetupCard />
        )}

        <div className="mt-16 grid gap-4 text-left sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5">
              <span
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg"
                style={{ backgroundColor: f.tint, color: f.color }}
              >
                <f.Icon size={22} aria-hidden />
              </span>
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const FEATURES = [
  {
    Icon: CalendarClock,
    color: "#1d4ed8",
    tint: "#dbeafe",
    title: "Auto-scheduling",
    body: "Generates rosters that respect each person's hours, days off, and preferences — no double-booking.",
  },
  {
    Icon: Stethoscope,
    color: "#0f766e",
    tint: "#ccfbf1",
    title: "Leave & MC",
    body: "Staff submit leave or medical certificates in-app; managers approve with a tap and get notified instantly.",
  },
  {
    Icon: Repeat,
    color: "#b45309",
    tint: "#fef3c7",
    title: "Instant cover",
    body: "Going on leave? Broadcast a cover request and the whole team is notified in real time.",
  },
];

function SetupCard() {
  return (
    <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-left">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-amber-900">
        <Settings size={18} aria-hidden /> One quick setup step left
      </h2>
      <p className="mt-2 text-sm text-amber-800">
        The app is running! To turn on accounts and data, connect a free
        Supabase database. Open <code className="rounded bg-amber-100 px-1">SETUP.md</code> in the
        project folder and follow Step 2 — it takes about 5 minutes. In short:
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-amber-800">
        <li>Create a free project at supabase.com</li>
        <li>Paste the schema from <code className="rounded bg-amber-100 px-1">supabase/schema.sql</code> into its SQL editor and run it</li>
        <li>
          Copy your project URL + anon key into{" "}
          <code className="rounded bg-amber-100 px-1">.env.local</code>
        </li>
        <li>Restart the app — this screen turns into your login</li>
      </ol>
    </div>
  );
}
