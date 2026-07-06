"use client";

import { useFormStatus } from "react-dom";
import { btnPrimary } from "@/lib/ui";

export function SubmitButton({
  children,
  className,
  title,
  quiet = false,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  /** Icon-only buttons: keep the icon while pending instead of swap text. */
  quiet?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} title={title} className={className ?? btnPrimary}>
      {pending && !quiet ? "Please wait…" : children}
    </button>
  );
}
