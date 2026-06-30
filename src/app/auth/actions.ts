"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string } | undefined;

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

export async function loginAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  // "/" routes to the correct dashboard based on role.
  redirect("/");
}

export async function signupAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");
  const fullName = field(formData, "fullName");
  const role = field(formData, "role");
  const orgName = field(formData, "orgName");
  const joinCode = field(formData, "joinCode");

  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }
  if (role === "manager" && !orgName) {
    return { error: "Please enter a name for your team / organization." };
  }
  if (role === "employee" && !joinCode) {
    return { error: "Please enter the join code your manager gave you." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };

  // Email confirmation is enabled -> no session yet.
  if (!data.session) {
    redirect("/login?notice=confirm-email");
  }

  if (role === "manager") {
    const { error: rpcError } = await supabase.rpc("create_org_and_manager", {
      p_org_name: orgName,
      p_full_name: fullName,
    });
    if (rpcError) return { error: rpcError.message };
    redirect("/manager");
  }

  const { error: rpcError } = await supabase.rpc("join_org_by_code", {
    p_code: joinCode,
    p_full_name: fullName,
  });
  if (rpcError) return { error: rpcError.message };
  redirect("/dashboard");
}

export async function onboardingAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const fullName = field(formData, "fullName");
  const role = field(formData, "role");
  const orgName = field(formData, "orgName");
  const joinCode = field(formData, "joinCode");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (role === "manager") {
    if (!orgName) return { error: "Please enter a team / organization name." };
    const { error } = await supabase.rpc("create_org_and_manager", {
      p_org_name: orgName,
      p_full_name: fullName,
    });
    if (error) return { error: error.message };
    redirect("/manager");
  }

  if (!joinCode) return { error: "Please enter your team join code." };
  const { error } = await supabase.rpc("join_org_by_code", {
    p_code: joinCode,
    p_full_name: fullName,
  });
  if (error) return { error: error.message };
  redirect("/dashboard");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
