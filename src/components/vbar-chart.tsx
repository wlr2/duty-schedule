// Vertical bar chart matching the dashboard's chart language: violet columns
// with rounded tops on token gridlines. Pure SVG server component.

export interface VBarItem {
  label: string;
  value: number;
  /** Optional comparison marker (e.g. required hours) drawn as a gold dash. */
  target?: number;
}

const H = 220;
const PAD_T = 18;
const PAD_B = 40;
const COL_W = 34;
const GAP = 26;
const PAD_L = 34;

export function VBarChart({ items, suffix = "" }: { items: VBarItem[]; suffix?: string }) {
  if (items.length === 0) return null;
  const maxV = Math.max(1, ...items.map((i) => Math.max(i.value, i.target ?? 0)));
  const W = PAD_L + items.length * (COL_W + GAP) + 10;
  const y = (v: number) => PAD_T + (1 - v / maxV) * (H - PAD_T - PAD_B);
  const yTicks = [0, Math.round(maxV / 2), maxV];

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ minWidth: Math.min(W, 680) }}
        className="w-full"
        role="img"
        aria-label="Hours per person"
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - 6} y1={y(v)} y2={y(v)} stroke="var(--t-grid)" strokeWidth="1" />
            <text x={PAD_L - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--t-axis)">
              {v}
            </text>
          </g>
        ))}

        {items.map((it, i) => {
          const x = PAD_L + GAP / 2 + i * (COL_W + GAP);
          const top = y(it.value);
          const h = Math.max(2, y(0) - top);
          return (
            <g key={it.label}>
              <rect
                x={x}
                y={top}
                width={COL_W}
                height={h}
                rx={7}
                fill="#7c5cff"
                opacity={0.9}
              />
              {/* value on top */}
              <text
                x={x + COL_W / 2}
                y={top - 5}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill="var(--t-heading, currentColor)"
              >
                {it.value}
                {suffix}
              </text>
              {/* optional target marker */}
              {it.target != null && it.target > 0 && (
                <line
                  x1={x - 4}
                  x2={x + COL_W + 4}
                  y1={y(it.target)}
                  y2={y(it.target)}
                  stroke="var(--t-gold)"
                  strokeWidth="2"
                  strokeDasharray="5 4"
                />
              )}
              {/* label */}
              <text
                x={x + COL_W / 2}
                y={H - 22}
                textAnchor="middle"
                fontSize="10"
                fill="var(--t-axis)"
              >
                {it.label.split(" ")[0]}
              </text>
              <text
                x={x + COL_W / 2}
                y={H - 10}
                textAnchor="middle"
                fontSize="10"
                fill="var(--t-axis)"
              >
                {it.label.split(" ").slice(1).join(" ")}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
