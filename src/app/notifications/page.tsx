import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { PushToggle } from "@/components/push-toggle";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AppNotification } from "@/lib/types";
import { markAllRead } from "./actions";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function NotificationsPage() {
  const session = await requireProfile();
  const profile = session.profile!;
  const org = profile.organizations!;

  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(50);

  const notifications = (data ?? []) as AppNotification[];
  const hasUnread = notifications.some((n) => !n.read);

  return (
    <>
      <AppHeader orgName={org.name} userName={profile.full_name ?? "You"} role={profile.role} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Notifications</h1>
          {hasUnread && (
            <form action={markAllRead}>
              <button className="text-sm font-medium text-slate-600 hover:text-slate-900">
                Mark all read
              </button>
            </form>
          )}
        </div>

        <div className="mt-5">
          <PushToggle vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
        </div>

        <div className="space-y-2">
          {notifications.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-card px-4 py-6 text-sm text-slate-500">
              No notifications yet.
            </p>
          )}
          {notifications.map((n) => {
            const inner = (
              <div
                className={`rounded-xl border px-4 py-3 ${
                  n.read
                    ? "border-slate-200 bg-card"
                    : "border-blue-200 bg-blue-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{n.title}</p>
                  <span className="shrink-0 text-xs text-slate-400">
                    {timeAgo(n.created_at)}
                  </span>
                </div>
                {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
              </div>
            );
            return n.link ? (
              <Link key={n.id} href={n.link} className="block">
                {inner}
              </Link>
            ) : (
              <div key={n.id}>{inner}</div>
            );
          })}
        </div>
      </main>
    </>
  );
}
