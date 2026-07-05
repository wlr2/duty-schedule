import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ManagerShell } from "@/components/manager-shell";

export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireManager();
  const profile = session.profile!;

  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.userId)
    .eq("read", false);

  return (
    <ManagerShell
      orgName={profile.organizations!.name}
      userName={profile.full_name ?? "Manager"}
      unread={count ?? 0}
    >
      {children}
    </ManagerShell>
  );
}
