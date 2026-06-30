import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  return (
    <AuthShell title="Welcome back" subtitle="Log in to your DutyRoster account.">
      <LoginForm notice={notice} />
    </AuthShell>
  );
}
