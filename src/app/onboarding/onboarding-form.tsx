"use client";

import { useActionState, useState } from "react";
import { onboardingAction, type AuthState } from "@/app/auth/actions";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, labelClass } from "@/lib/ui";
import type { Role } from "@/lib/types";

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [role, setRole] = useState<Role>("manager");
  const [state, action] = useActionState<AuthState, FormData>(onboardingAction, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="role" value={role} />

      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setRole("manager")}
          className={`rounded-md px-3 py-2 text-sm font-medium ${role === "manager" ? "bg-white shadow-sm" : "text-slate-500"}`}
        >
          Create a team
        </button>
        <button
          type="button"
          onClick={() => setRole("employee")}
          className={`rounded-md px-3 py-2 text-sm font-medium ${role === "employee" ? "bg-white shadow-sm" : "text-slate-500"}`}
        >
          Join a team
        </button>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="fullName" className={labelClass}>
          Your full name
        </label>
        <input
          id="fullName"
          name="fullName"
          required
          defaultValue={defaultName}
          className={inputClass}
        />
      </div>

      {role === "manager" ? (
        <div className="space-y-1.5">
          <label htmlFor="orgName" className={labelClass}>
            Team / organization name
          </label>
          <input id="orgName" name="orgName" className={inputClass} />
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="joinCode" className={labelClass}>
            Join code
          </label>
          <input id="joinCode" name="joinCode" className={`${inputClass} uppercase`} />
        </div>
      )}

      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <SubmitButton className="w-full inline-flex items-center justify-center rounded-lg bg-violet px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-soft disabled:opacity-60">
        Continue
      </SubmitButton>
    </form>
  );
}
