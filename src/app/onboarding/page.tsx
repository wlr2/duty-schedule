import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getSession } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Already set up -> go to the right place.
  if (session.profile?.org_id) {
    redirect(session.profile.role === "manager" ? "/manager" : "/dashboard");
  }

  return (
    <AuthShell
      title="One more step"
      subtitle="Create your team as a manager, or join an existing team."
    >
      <OnboardingForm
        defaultName={session.profile?.full_name ?? session.email?.split("@")[0] ?? ""}
      />
    </AuthShell>
  );
}
