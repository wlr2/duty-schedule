import { AuthShell } from "@/components/auth-shell";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <AuthShell
      title="Get started"
      subtitle="Create your team, or join one with a code."
    >
      <SignupForm />
    </AuthShell>
  );
}
