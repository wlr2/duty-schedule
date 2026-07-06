"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction, type AuthState } from "@/app/auth/actions";
import { SubmitButton } from "@/components/submit-button";
import { inputClass, labelClass } from "@/lib/ui";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action] = useActionState<AuthState, FormData>(loginAction, undefined);

  return (
    <form action={action} className="space-y-4">
      {notice === "confirm-email" && (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Account created. Please confirm your email, then log in.
        </p>
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
        <input id="password" name="password" type="password" required className={inputClass} />
      </div>

      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <SubmitButton className="w-full inline-flex items-center justify-center rounded-lg bg-violet px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-soft disabled:opacity-60">
        Log in
      </SubmitButton>

      <p className="text-center text-sm text-slate-600">
        New here?{" "}
        <Link href="/signup" className="font-medium text-slate-900 underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
