"use client";

import { useState } from "react";
import { FlaskConical, Play } from "lucide-react";
import { VBarChart } from "@/components/vbar-chart";
import type { StressReport, ScenarioResult } from "@/lib/stress-test";
import { runStress } from "./actions";

interface PeriodOpt {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
}
interface StaffOpt {
  id: string;
  name: string;
}

function fmtMin(min: number): string {
  return `${Math.round(min / 6) / 10}h`;
}

function fmt12(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${ampm}`;
}

export function StressClient({ periods, staff }: { periods: PeriodOpt[]; staff: StaffOpt[] }) {
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [report, setReport] = useState<StressReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  async function run(custom: boolean) {
    if (!periodId || busy) return;
    setBusy(true);
    setError(null);
    setOpen(null);
    try {
      const res = await runStress({
        periodId,
        absentIds: custom ? picked : undefined,
        fromDate: custom && fromDate ? fromDate : undefined,
        toDate: custom && toDate ? toDate : undefined,
      });
      if ("error" in res) setError(res.error);
      else setReport(res);
    } catch {
      setError("The simulation hit an error — try again.");
    } finally {
      setBusy(false);
    }
  }

  function togglePick(id: string) {
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length >= 2 ? p : [...p, id],
    );
  }

  const worst = report?.scenarios.find((s) => !s.absorbed) ?? null;

  return (
    <div>
      {/* Controls */}
      <div className="mt-6 space-y-3 rounded-[20px] border border-slate-200 bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="period">
              Schedule
            </label>
            <select
              id="period"
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => run(false)}
            disabled={busy || !periodId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white hover:bg-violet-soft disabled:opacity-50"
          >
            <Play size={15} aria-hidden />
            {busy ? "Simulating…" : "Run full sweep"}
          </button>
        </div>

        <details className="rounded-xl bg-slate-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">
            Custom scenario (pick 1–2 people, optional date range)
          </summary>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {staff.map((s) => (
              <button
                key={s.id}
                onClick={() => togglePick(s.id)}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  picked.includes(s.id)
                    ? "border-violet bg-violet text-white"
                    : "border-slate-300 text-slate-700 hover:border-violet/60"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-slate-500" htmlFor="from">From</label>
              <input id="from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-500" htmlFor="to">To</label>
              <input id="to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </div>
            <button
              onClick={() => run(true)}
              disabled={busy || picked.length === 0}
              className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Simulate this absence
            </button>
          </div>
        </details>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {report && (
        <div className="mt-6 space-y-5 fade-in">
          {/* Headline cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[20px] border border-slate-200 bg-card p-4">
              <p className="text-sm text-slate-500">Resilience</p>
              <p className="font-display mt-1 text-3xl font-bold">{report.resilienceScore}%</p>
              <p className="text-xs text-slate-500">of absences fully absorbed</p>
            </div>
            <div className="rounded-[20px] border border-slate-200 bg-card p-4">
              <p className="text-sm text-slate-500">Weakest point</p>
              <p className="font-display mt-1 truncate text-3xl font-bold">
                {worst ? worst.absentNames.join(" + ") : "None"}
              </p>
              <p className="text-xs text-slate-500">
                {worst ? `${fmtMin(worst.deltaGapMinutes)} of coverage breaks` : "every absence is coverable"}
              </p>
            </div>
            <div className="rounded-[20px] border border-slate-200 bg-card p-4">
              <p className="text-sm text-slate-500">Already open (baseline)</p>
              <p className="font-display mt-1 text-3xl font-bold">{fmtMin(report.baselineGapMinutes)}</p>
              <p className="text-xs text-slate-500">not counted against anyone</p>
            </div>
          </div>

          {report.truncated && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
              Large team/range: only the 30 most-scheduled people (or first 31 days) were swept.
              Use the custom panel for a narrower question.
            </p>
          )}

          {/* Chart */}
          {report.scenarios.some((s) => s.deltaGapMinutes > 0) && (
            <div className="rounded-[20px] border border-slate-200 bg-card p-4">
              <VBarChart
                items={report.scenarios
                  .filter((s) => s.deltaGapMinutes > 0)
                  .slice(0, 12)
                  .map((s) => ({
                    label: s.absentNames.join(" + "),
                    value: Math.round(s.deltaGapMinutes / 6) / 10,
                  }))}
                suffix="h"
              />
              <p className="mt-1 text-center text-xs text-slate-400">
                Coverage hours that break if this person is away
              </p>
            </div>
          )}

          {/* Sweep table */}
          <div className="overflow-x-auto rounded-[20px] border border-slate-200 bg-card">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-4 py-2 text-right font-medium">Gap caused</th>
                  <th className="px-4 py-2 font-medium">Positions broken</th>
                  <th className="px-4 py-2 font-medium">First break</th>
                  <th className="px-4 py-2 text-right font-medium">Rule bends</th>
                  <th className="px-4 py-2 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {report.scenarios.map((s: ScenarioResult, i) => (
                  <>
                    <tr
                      key={i}
                      onClick={() => setOpen(open === i ? null : i)}
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-2 font-medium">{s.absentNames.join(" + ")}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {s.deltaGapMinutes > 0 ? fmtMin(s.deltaGapMinutes) : "—"}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {s.positionsBroken.join(", ") || "—"}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{s.firstBreakDate ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{s.relaxationsIncurred || "—"}</td>
                      <td className="px-4 py-2">
                        {s.absorbed ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            Absorbed
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Breaks coverage
                          </span>
                        )}
                      </td>
                    </tr>
                    {open === i && s.brokenSlices.length > 0 && (
                      <tr key={`d${i}`} className="border-t border-slate-100 bg-slate-50">
                        <td colSpan={6} className="px-4 py-3">
                          <ul className="space-y-1.5 text-xs text-slate-600">
                            {s.brokenSlices.slice(0, 12).map((b, j) => (
                              <li key={j}>
                                <span className="font-medium text-slate-700">
                                  {b.date} · {b.positionName} · {fmt12(b.startMin)}–{fmt12(b.endMin)}
                                </span>{" "}
                                — {b.missing} short
                                {b.reasons.length > 0 && (
                                  <span className="text-slate-500"> ({b.reasons.slice(0, 3).join("; ")})</span>
                                )}
                              </li>
                            ))}
                            {s.brokenSlices.length > 12 && (
                              <li className="text-slate-400">…and {s.brokenSlices.length - 12} more slices</li>
                            )}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!report && !error && (
        <p className="mt-8 flex items-center justify-center gap-2 rounded-[20px] border border-slate-200 bg-card px-4 py-10 text-sm text-slate-500">
          <FlaskConical size={16} aria-hidden />
          Run a sweep to see who the roster can least afford to lose.
        </p>
      )}
    </div>
  );
}
