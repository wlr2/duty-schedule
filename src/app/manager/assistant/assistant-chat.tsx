"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BookOpenText, CheckCheck, Send, Sparkles } from "lucide-react";
import { RichText } from "@/components/rich-text";
import { endConversation } from "./actions";

type ApiMessage = { role: string; content: unknown };
type Bubble = {
  role: "user" | "assistant";
  text: string;
  actions?: string[];
  needsConfirm?: boolean;
};

const EXAMPLES = [
  "Set up NS guard duty: Sentry, PAC and VAC — 1 person each, rotate every 2h with 2h rest, covering 08:00–20:00. Everyone eligible.",
  "I run a restaurant. For the dinner shift 17:00–23:00 I need 5 dishwashers, 5 servers and 5 runners on at once.",
  "What positions do I have set up right now?",
];

const SAVE_AND_END =
  "We're wrapping up this chat. Save anything durable you learned here (conventions, preferences, corrections, people notes) to memory now, then reply with a one-line goodbye.";

/** Rebuild display bubbles from a stored conversation. */
function bubblesFrom(messages: ApiMessage[]): Bubble[] {
  const out: Bubble[] = [];
  for (const m of messages) {
    if (m.role === "user" && typeof m.content === "string") {
      out.push({ role: "user", text: m.content });
    } else if (m.role === "assistant" && Array.isArray(m.content)) {
      const text = (m.content as { type: string; text?: string }[])
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text as string)
        .join("\n")
        .split("[CONFIRM_REQUIRED]")
        .join("")
        .trim();
      if (text) out.push({ role: "assistant", text });
    }
  }
  return out;
}

export function AssistantChat({
  initialConversationId,
  initialMessages,
}: {
  initialConversationId: string | null;
  initialMessages: ApiMessage[];
}) {
  const initialBubbles = useMemo(() => bubblesFrom(initialMessages), [initialMessages]);
  const [bubbles, setBubbles] = useState<Bubble[]>(initialBubbles);
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>(initialMessages);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string, confirmed = false): Promise<string | null> {
    const content = text.trim();
    if (!content || loading) return conversationId;
    let convId = conversationId;
    setInput("");
    setBubbles((b) => [...b, { role: "user", text: content }]);
    setLoading(true);

    const nextApi = [...apiMessages, { role: "user", content }];
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextApi, confirmed, conversationId }),
      });
      const data = await res.json();
      if (data.error) {
        setBubbles((b) => [...b, { role: "assistant", text: data.error }]);
      } else {
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setApiMessages(data.messages);
        }
        if (typeof data.conversationId === "string") {
          convId = data.conversationId;
          setConversationId(data.conversationId);
        }
        setBubbles((b) => [
          ...b,
          {
            role: "assistant",
            text: data.reply || "Done.",
            actions: data.actions,
            needsConfirm: data.needsConfirm === true,
          },
        ]);
      }
    } catch {
      setBubbles((b) => [
        ...b,
        { role: "assistant", text: "Sorry — I couldn't reach the assistant. Try again." },
      ]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }),
      );
    }
    return convId;
  }

  /** Ask the assistant to bank its learnings, then start a fresh chat. */
  async function saveAndEnd() {
    if (loading || bubbles.length === 0) return;
    const id = await send(SAVE_AND_END);
    if (id) await endConversation(id);
    setBubbles([]);
    setApiMessages([]);
    setConversationId(null);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 4000);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] w-full max-w-2xl flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-violet text-white">
            <Sparkles size={18} aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold leading-tight">Scheduling assistant</h1>
            <p className="text-sm text-slate-500">
              Describe your duties or shifts in plain words — I&apos;ll set them up.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {bubbles.length > 0 && (
            <button
              onClick={saveAndEnd}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-soft disabled:opacity-50"
              title="The assistant saves what it learned to memory, then the chat clears"
            >
              <CheckCheck size={14} aria-hidden /> Save &amp; end chat
            </button>
          )}
          <Link
            href="/manager/assistant/memory"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            <BookOpenText size={14} aria-hidden /> What it knows
          </Link>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-card p-4"
      >
        {justSaved && (
          <p className="rounded-xl bg-green-100 px-4 py-2.5 text-center text-sm font-medium text-green-800">
            ✓ Learnings saved to memory — fresh chat started.
          </p>
        )}
        {bubbles.length === 0 && (
          <div className="py-6 text-center">
            <p className="text-sm text-slate-500">Try one of these to start:</p>
            <div className="mt-3 space-y-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-sm hover:border-violet/60"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {bubbles.map((b, i) => (
          <div key={i} className={b.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                b.role === "user"
                  ? "bg-violet text-white"
                  : "border border-slate-200 bg-slate-50 text-slate-800"
              }`}
            >
              <RichText text={b.text} />
              {b.actions && b.actions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {b.actions.map((a, j) => (
                    <span
                      key={j}
                      className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
                    >
                      ✓ {a}
                    </span>
                  ))}
                </div>
              )}
              {b.needsConfirm && i === bubbles.length - 1 && !loading && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => send("Confirmed — apply the changes.", true)}
                    className="rounded-lg bg-green-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                  >
                    ✓ Yes, apply it
                  </button>
                  <button
                    onClick={() => send("No — don't apply that.")}
                    className="rounded-lg border border-slate-300 bg-card px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-400">
              Thinking…
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your schedule, or ask a question…"
          className="flex-1 rounded-xl border border-slate-300 bg-card px-4 py-2.5 text-sm outline-none focus:border-violet"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-violet px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-soft disabled:opacity-50"
        >
          <Send size={16} aria-hidden /> Send
        </button>
      </form>
    </div>
  );
}
