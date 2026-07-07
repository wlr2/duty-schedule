// ============================================================================
// Signature coverage chart: filled violet area = people actually ON DUTY
// across the day; dashed gold line = REQUIRED headcount. A gap reads
// instantly as the violet dipping below the gold dashes.
// Pure SVG server component — reused by the dashboard and analytics.
// ============================================================================

export interface CoveragePoint {
  /** Minute of day (0..1440). */
  min: number;
  staffed: number;
  required: number;
}

const W = 720;
const H = 200;
const PAD_L = 30;
const PAD_B = 24;
const PAD_T = 14;

export function CoverageChart({
  points,
  startMin = 0,
  endMin = 1440,
}: {
  points: CoveragePoint[];
  startMin?: number;
  endMin?: number;
}) {
  const span = Math.max(1, endMin - startMin);
  const maxY = Math.max(1, ...points.map((p) => Math.max(p.staffed, p.required))) + 1;
  const x = (min: number) => PAD_L + ((min - startMin) / span) * (W - PAD_L - 8);
  const y = (v: number) => PAD_T + (1 - v / maxY) * (H - PAD_T - PAD_B);

  // Step-wise paths (headcount changes in blocks, not slopes).
  const steps = (get: (p: CoveragePoint) => number) => {
    if (points.length === 0) return "";
    let d = `M ${x(points[0].min)} ${y(get(points[0]))}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${x(points[i].min)} ${y(get(points[i - 1]))} L ${x(points[i].min)} ${y(get(points[i]))}`;
    }
    d += ` L ${x(endMin)} ${y(get(points[points.length - 1]))}`;
    return d;
  };
  const staffedLine = steps((p) => p.staffed);
  const areaPath =
    points.length > 0
      ? `${staffedLine} L ${x(endMin)} ${y(0)} L ${x(points[0].min)} ${y(0)} Z`
      : "";
  const requiredLine = steps((p) => p.required);

  // Hour labels every 3h within the window.
  const hourTicks: number[] = [];
  for (let m = Math.ceil(startMin / 180) * 180; m <= endMin; m += 180) hourTicks.push(m);
  const yTicks = Array.from({ length: maxY + 1 }, (_, i) => i).filter(
    (v) => maxY <= 6 || v % 2 === 0,
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label="People on duty versus required headcount across the day"
    >
      <defs>
        <linearGradient id="covFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c5cff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#7c5cff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* horizontal gridlines + y labels */}
      {yTicks.map((v) => (
        <g key={v}>
          <line
            x1={PAD_L}
            x2={W - 8}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--t-grid)"
            strokeWidth="1"
          />
          <text x={PAD_L - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--t-axis)">
            {v}
          </text>
        </g>
      ))}

      {/* staffed area + line (violet) */}
      {areaPath && <path d={areaPath} fill="url(#covFill)" />}
      {staffedLine && (
        <path d={staffedLine} fill="none" stroke="#7c5cff" strokeWidth="2.5" strokeLinejoin="round" />
      )}

      {/* required line (dashed gold) */}
      {requiredLine && (
        <path
          d={requiredLine}
          fill="none"
          stroke="var(--t-gold)"
          strokeWidth="2"
          strokeDasharray="6 5"
          strokeLinejoin="round"
        />
      )}

      {/* x labels */}
      {hourTicks.map((m) => (
        <text
          key={m}
          x={x(m)}
          y={H - 6}
          textAnchor="middle"
          fontSize="10"
          fill="var(--t-axis)"
        >
          {`${Math.floor(m / 60) % 24}:00`}
        </text>
      ))}
    </svg>
  );
}

/** Legend chips for the chart, rendered by the host card. */
export function CoverageChartLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-4 rounded-sm bg-violet/70" /> On duty
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="18" height="6" aria-hidden>
          <line x1="0" y1="3" x2="18" y2="3" stroke="var(--t-gold)" strokeWidth="2" strokeDasharray="4 3" />
        </svg>
        Required
      </span>
    </div>
  );
}
