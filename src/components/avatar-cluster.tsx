// Overlapping initials avatars with a dark ring — the reference's face pills.
const PALETTE = ["#7c5cff", "#2dd4bf", "#e9c46a", "#f472b6", "#60a5fa", "#34d399"];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-[#0a0a0c] ring-2 ring-[#151419]"
      style={{
        width: size,
        height: size,
        backgroundColor: colorFor(name),
        fontSize: Math.max(10, size * 0.36),
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function AvatarCluster({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="flex items-center -space-x-2">
      {shown.map((n) => (
        <Avatar key={n} name={n} size={26} />
      ))}
      {extra > 0 && (
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 ring-2 ring-[#151419]">
          +{extra}
        </span>
      )}
    </span>
  );
}
