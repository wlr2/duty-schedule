import Link from "next/link";
import { Bell } from "lucide-react";
import { logoutAction } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Role } from "@/lib/types";

export async function AppHeader({
  orgName,
  userName,
  role,
}: {
  orgName: string;
  userName: string;
  role: Role;
}) {
  const home = role === "manager" ? "/manager" : "/dashboard";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let unread = 0;
  if (user) {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("read", false);
    unread = count ?? 0;
  }

  return (
    <header className="border-b border-slate-200 bg-card">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href={home} className="flex items-center gap-2 font-semibold">
          <Logo size={28} />
          {orgName}
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <ThemeToggle />
          {/* Notification bell */}
          <Link
            href="/notifications"
            className="relative rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
            aria-label="Notifications"
          >
            <Bell size={20} aria-hidden />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>

          <span className="hidden text-slate-600 sm:inline">
            {userName}
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs capitalize text-slate-600">
              {role}
            </span>
          </span>
          <form action={logoutAction}>
            <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
