// Server-side helpers for reading the logged-in user and their profile.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { Organization, Profile } from "@/lib/types";

export interface SessionInfo {
  userId: string;
  email: string | null;
  profile: (Profile & { organizations: Organization | null }) | null;
}

/** Returns the current session + profile, or null if not logged in. */
export async function getSession(): Promise<SessionInfo | null> {
  // Before the database is connected there is no session to read.
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*, organizations(*)")
    .eq("id", user.id)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: (profile as SessionInfo["profile"]) ?? null,
  };
}

/** Require a logged-in user with a completed profile, else redirect. */
export async function requireProfile(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.profile || !session.profile.org_id) redirect("/onboarding");
  return session;
}

/** Require a manager, else send to the employee area. */
export async function requireManager(): Promise<SessionInfo> {
  const session = await requireProfile();
  if (session.profile!.role !== "manager") redirect("/dashboard");
  return session;
}
