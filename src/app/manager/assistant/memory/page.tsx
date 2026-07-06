import Link from "next/link";
import { ArrowLeft, BookOpenText } from "lucide-react";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { SubmitButton } from "@/components/submit-button";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteMemoryFile, saveMemoryFile, wipeAllMemory } from "./actions";

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function AssistantMemoryPage() {
  const session = await requireManager();
  const profile = session.profile!;
  const supabase = await createClient();

  const { data } = await supabase
    .from("assistant_memories")
    .select("path, content, updated_at")
    .eq("org_id", profile.org_id)
    .order("path");
  const files = (data ?? []) as { path: string; content: string; updated_at: string }[];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        href="/manager/assistant"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} aria-hidden /> Back to assistant
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpenText size={22} aria-hidden />
          <h1 className="text-2xl font-bold">What the assistant knows</h1>
        </div>
        {files.length > 0 && (
          <form action={wipeAllMemory}>
            <ConfirmSubmit
              message="Erase EVERYTHING the assistant has learned about your team? It will start from scratch."
              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Wipe all memory
            </ConfirmSubmit>
          </form>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Notes the assistant keeps about your team&apos;s conventions and preferences. Edit
        anything that&apos;s wrong — it takes effect on its very next reply. Hard facts
        (staff, positions, hours) live in the app itself, not here.
      </p>

      {files.length === 0 && (
        <p className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          Nothing learned yet. Chat with the assistant — it takes notes as you go.
        </p>
      )}

      <div className="mt-5 space-y-3">
        {files.map((f) => (
          <details key={f.path} className="rounded-xl border border-slate-200 bg-white">
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3">
              <span className="font-medium">{f.path.replace("/memories/", "")}</span>
              <span className="text-xs text-slate-400">updated {timeAgo(f.updated_at)}</span>
            </summary>
            <div className="border-t border-slate-100 p-4">
              <form action={saveMemoryFile} className="space-y-2">
                <input type="hidden" name="path" value={f.path} />
                <textarea
                  name="content"
                  defaultValue={f.content}
                  rows={Math.min(14, Math.max(4, f.content.split("\n").length + 1))}
                  className="w-full rounded-lg border border-slate-300 p-3 font-mono text-sm outline-none focus:border-slate-900"
                />
                <div className="flex items-center gap-2">
                  <SubmitButton className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
                    Save changes
                  </SubmitButton>
                </div>
              </form>
              <form action={deleteMemoryFile} className="mt-2">
                <input type="hidden" name="path" value={f.path} />
                <ConfirmSubmit
                  message={`Delete ${f.path}? The assistant will forget these notes.`}
                  className="text-sm text-red-600 hover:underline"
                >
                  Delete this file
                </ConfirmSubmit>
              </form>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
