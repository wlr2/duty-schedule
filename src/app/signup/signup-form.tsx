"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signupAction, type AuthState } from "@/app/auth/actions";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, labelClass } from "@/lib/ui";
import type { Role } from "@/lib/types";

export function SignupForm() {
  const [role, setRole] = useState<Role>("manager");
  const [state, action] = useActionState<AuthState, FormData>(signupAction, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="role" value={role} />

      {/* Role chooser */}
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
        <RoleTab
          active={role === "manager"}
          onClick={() => setRole("manager")}
          title="I manage a team"
        />
        <RoleTab
          active={role === "employee"}
          onClick={() => setRole("employee")}
          title="I'm joining a team"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="fullName" className={labelClass}>
          Your full name
        </label>
        <input id="fullName" name="fullName" required className={inputClass} />
      </div>

      {role === "manager" ? (
        <div className="space-y-1.5">
          <label htmlFor="orgName" className={labelClass}>
            Team / organization name
          </label>
          <input
            id="orgName"
            name="orgName"
            placeholder="e.g. Ward 5 Nursing"
            className={inputClass}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="joinCode" className={labelClass}>
            Join code from your manager
          </label>
          <input
            id="joinCode"
            name="joinCode"
            placeholder="e.g. 7K2Q9A"
            className={`${inputClass} uppercase`}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input id="email" name="email" type="email" required className={inputClass} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          className={inputClass}
        />
        <p className="text-xs text-slate-500">At least 6 characters.</p>
      </div>

      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <SubmitButton className="w-full inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
        {role === "manager" ? "Create my team" : "Join team"}
      </SubmitButton>

      <p className="text-center text-sm text-slate-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-slate-900 underline">
          Log in
        </Link>
      </p>
    </form>
  );
}

function RoleTab({
  active,
  onClick,
  title,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-2 text-sm font-medium transition ${
        active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {title}
    </button>
  );
}
