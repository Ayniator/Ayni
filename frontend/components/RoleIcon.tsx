// Inline SVG glyphs for the 7 Council seats. Per request:
//   Treasurer       → a gold coin
//   Scribe-Secretary→ a pyramid
//   Rhythm Keeper   → a feathered chief's headdress
//   Elders (N/E/S/W)→ the four Direction artworks (/public/directions/{N,E,S,W}.png)
// Self-contained (no icon dependency); colored to fit the light theme.

const DIR = ["N", "E", "S", "W"]; // Elder of the North/East/South/West

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

  // 3..6 — Elders of the four directions: the supplied Direction artworks.
  const dir = seat - 3;
  const D = ["North", "East", "South", "West"];
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`/directions/${DIR[dir] ?? "N"}.png`}
      alt={`Elder of the ${D[dir] ?? ""}`}
      width={size}
      height={size}
      style={{ flexShrink: 0, verticalAlign: "-3px", borderRadius: "50%", objectFit: "cover" }}
    />
  );
}
