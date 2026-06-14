// Inline SVG glyphs for the 7 Council seats. Per request:
//   Treasurer       → a gold coin
//   Scribe-Secretary→ a pyramid
//   Rhythm Keeper   → a feathered chief's headdress
//   Elders (N/E/S/W)→ a medicine-wheel direction marker
// Self-contained (no icon dependency); colored to fit the light theme.

const DIR = ["N", "E", "S", "W"]; // Elder of the North/East/South/West
const WHEEL = ["#cfd3df", "#e7b53b", "#d8604f", "#3a3f55"]; // N white, E yellow, S red, W black

export default function RoleIcon({ seat, size = 18 }: { seat: number; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
    style: { flexShrink: 0, verticalAlign: "-3px" as const },
  };

  // 0 — Treasurer: gold coin
  if (seat === 0)
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" fill="#f4c43a" stroke="#c9971a" strokeWidth="1.3" />
        <circle cx="12" cy="12" r="6" fill="none" stroke="#c9971a" strokeWidth="1" opacity="0.7" />
        <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="700" fill="#9a6f12">
          ◎
        </text>
      </svg>
    );

  // 1 — Scribe-Secretary: pyramid
  if (seat === 1)
    return (
      <svg {...common}>
        <path d="M12 3 L21 20 H3 Z" fill="#b79bf6" stroke="#6d4cff" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M12 3 L12 20" stroke="#6d4cff" strokeWidth="1" opacity="0.65" />
        <path d="M7.5 11.5 L16.5 11.5" stroke="#6d4cff" strokeWidth="0.9" opacity="0.5" />
        <path d="M5.2 16 L18.8 16" stroke="#6d4cff" strokeWidth="0.9" opacity="0.5" />
      </svg>
    );

  // 2 — Rhythm Keeper: feathered chief's headdress
  if (seat === 2)
    return (
      <svg {...common}>
        {[-2, -1, 0, 1, 2].map((i) => {
          const x = 12 + i * 3.1;
          const tilt = i * 9;
          return (
            <path
              key={i}
              d={`M12 13 Q${x} ${3 - Math.abs(i)} ${x + (tilt > 0 ? 0.4 : -0.4)} ${2 - Math.abs(i)}`}
              transform={`rotate(${tilt} 12 13)`}
              stroke={i % 2 ? "#d8604f" : "#e7b53b"}
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
            />
          );
        })}
        {/* headband */}
        <path d="M6 13.5 Q12 16 18 13.5" stroke="#8a5a2b" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <circle cx="12" cy="14.4" r="1.1" fill="#d8604f" />
      </svg>
    );

  // 3..6 — Elders of the four directions: a quartered medicine wheel + letter
  const dir = seat - 3;
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" fill="#fff" stroke="#b9bed0" strokeWidth="1.2" />
      <path d="M12 3 A9 9 0 0 1 21 12 L12 12 Z" fill={WHEEL[(dir + 0) % 4]} opacity="0.85" />
      <path d="M21 12 A9 9 0 0 1 12 21 L12 12 Z" fill={WHEEL[(dir + 1) % 4]} opacity="0.85" />
      <path d="M12 21 A9 9 0 0 1 3 12 L12 12 Z" fill={WHEEL[(dir + 2) % 4]} opacity="0.85" />
      <path d="M3 12 A9 9 0 0 1 12 3 L12 12 Z" fill={WHEEL[(dir + 3) % 4]} opacity="0.85" />
      <circle cx="12" cy="12" r="3.4" fill="#fff" stroke="#b9bed0" strokeWidth="1" />
      <text x="12" y="14.6" textAnchor="middle" fontSize="5.4" fontWeight="800" fill="#2a2f45">
        {DIR[dir] ?? ""}
      </text>
    </svg>
  );
}
