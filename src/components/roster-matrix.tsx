// Horizontal timeline roster: people as rows, hourly columns with a full grid,
// color-coded duty bands, a total-hours column, and red rows for anyone off-duty.
import type { RosterRow } from "@/lib/roster";

export function RosterMatrix({
  hourLabels,
  rows,
}: {
  hourLabels: string[];
  rows: RosterRow[];
}) {
  const minWidth = 120 + hourLabels.length * 58 + 56;

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-300 bg-card">
      <table
        className="border-collapse text-[11px]"
        style={{ minWidth, tableLayout: "fixed", width: "100%" }}
      >
        <colgroup>
          <col style={{ width: 120 }} />
          {hourLabels.map((_, i) => (
            <col key={i} style={{ width: 58 }} />
          ))}
          <col style={{ width: 56 }} />
        </colgroup>

        <thead>
          <tr className="bg-surface2">
            <th className="sticky left-0 z-20 border border-slate-300 bg-surface2 px-3 py-2 text-left font-medium text-slate-900">
              Name
            </th>
            {hourLabels.map((l) => (
              <th
                key={l}
                className="border border-slate-300 px-1 py-2 font-normal text-slate-500"
              >
                {l.replace(" - ", "–")}
              </th>
            ))}
            <th className="border border-slate-300 px-1 py-2 font-medium text-slate-900">
              Total
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td
                className={`sticky left-0 z-10 border border-slate-300 bg-surface2 px-3 py-1.5 font-medium whitespace-nowrap ${
                  r.off ? "text-red-600" : "text-slate-900"
                }`}
              >
                {r.name}
              </td>

              {r.off ? (
                <td
                  colSpan={hourLabels.length}
                  className="border border-slate-300 bg-red-500 px-2 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-white"
                >
                  Off duty
                </td>
              ) : (
                r.cells.map((c, i) => (
                  <td
                    key={i}
                    className={`overflow-hidden border border-slate-300 px-0.5 py-1.5 text-center font-semibold ${
                      c.color ? "text-white" : "text-slate-400"
                    }`}
                    style={c.color ? { backgroundColor: c.color } : undefined}
                  >
                    {c.showLabel ? c.label : " "}
                  </td>
                ))
              )}

              <td className="border border-slate-300 bg-slate-50 px-1 py-1.5 text-center font-bold text-slate-900">
                {r.totalHours}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
