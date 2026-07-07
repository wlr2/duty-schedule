"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  CalendarDays,
  CalendarOff,
  FlaskConical,
  LayoutDashboard,
  Repeat,
  Sparkles,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { logoutAction } from "@/app/auth/actions";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/manager", label: "Overview", Icon: LayoutDashboard },
  { href: "/manager/assistant", label: "AI assistant", Icon: Sparkles },
  { href: "/manager/schedule", label: "Schedule", Icon: CalendarDays },
  { href: "/manager/team", label: "Positions", Icon: Users },
  { href: "/manager/staff", label: "Team", Icon: UsersRound },
  { href: "/manager/leave", label: "Leave requests", Icon: CalendarOff },
  { href: "/manager/coverage", label: "Coverage & gaps", Icon: Repeat },
  { href: "/manager/stress-test", label: "Stress test", Icon: FlaskConical },
  { href: "/manager/analytics", label: "Analytics", Icon: BarChart3 },
];

function isActive(pathname: string, href: string) {
  return href === "/manager" ? pathname === "/manager" : pathname.startsWith(href);
}

export function ManagerShell({
  orgName,
  userName,
  unread,
  children,
}: {
  orgName: string;
  userName: string;
  unread: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-full flex-col">
      {/* Top bar */}
      <header className="border-b border-slate-200 bg-card">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/manager" className="flex items-center gap-2 font-semibold">
            <Logo size={28} />
            <span className="truncate">{orgName}</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <ThemeToggle />
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
            <span className="hidden text-slate-600 sm:inline">{userName}</span>
            <form action={logoutAction}>
              <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100">
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/* Mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1.5 md:hidden">
          {NAV.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${
                isActive(pathname, href)
                  ? "bg-violet text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon size={15} aria-hidden /> {label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="flex flex-1">
        {/* Sidebar (desktop) */}
        <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-card md:block">
          <nav className="sticky top-0 space-y-1 p-3">
            {NAV.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive(pathname, href)
                    ? "bg-violet text-white"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <Icon size={17} aria-hidden /> {label}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="flex-1 px-4 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
