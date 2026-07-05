"use client";

import { useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";

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

export default function AssistantPage() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string, confirmed = false) {
    const content = text.trim();
    if (!content || loading) return;
    setInput("");
    setBubbles((b) => [...b, { role: "user", text: content }]);
    setLoading(true);

    const nextApi = [...apiMessages, { role: "user", content }];
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextApi, confirmed }),
      });
      const data = await res.json();
      if (data.error) {
        setBubbles((b) => [...b, { role: "assistant", text: data.error }]);
      } else {
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setApiMessages(data.messages);
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
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] w-full max-w-2xl flex-col">
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-900 text-white">
          <Sparkles size={18} aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-bold leading-tight">Scheduling assistant</h1>
          <p className="text-sm text-slate-500">
            Describe your duties or shifts in plain words — I&apos;ll set them up.
          </p>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4"
      >
        {bubbles.length === 0 && (
          <div className="py-6 text-center">
            <p className="text-sm text-slate-500">Try one of these to start:</p>
            <div className="mt-3 space-y-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => send(ex)}
                  className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-sm hover:border-slate-400"
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
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-slate-50 text-slate-800"
              }`}
            >
              {b.text}
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
                    className="rounded-lg bg-green-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
                  >
                    ✓ Yes, apply it
                  </button>
                  <button
                    onClick={() => send("No — don't apply that.")}
                    className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
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
          className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-slate-900"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          <Send size={16} aria-hidden /> Send
        </button>
      </form>
    </div>
  );
}
