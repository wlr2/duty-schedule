// Custom DutyRoster brand mark: three colored duty bands on a dark tile,
// echoing the roster timeline. Pure SVG — transparent, no copyright.
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="DutyRoster"
      fill="none"
    >
      <rect width="32" height="32" rx="8" fill="#0f172a" />
      <rect x="7" y="8.5" width="13" height="3.4" rx="1.7" fill="#3b82f6" />
      <rect x="7" y="14.3" width="18" height="3.4" rx="1.7" fill="#2dd4bf" />
      <rect x="7" y="20.1" width="9" height="3.4" rx="1.7" fill="#f59e0b" />
    </svg>
  );
}
