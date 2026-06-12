"use client";

import { useMemo } from "react";
import { generateJazziconSvg } from "../lib/jazzicon";

/**
 * Deterministic Jazzicon avatar for any string (a Circle address, a member
 * commitment, a Council seat key…). Same input → same colorful coin.
 */
export default function Identicon({
  seed,
  size = 48,
  title,
  className,
}: {
  seed: string;
  size?: number;
  title?: string;
  className?: string;
}) {
  const svg = useMemo(() => generateJazziconSvg(seed, size), [seed, size]);
  return (
    <span
      className={className}
      title={title ?? seed}
      style={{ display: "inline-block", width: size, height: size, lineHeight: 0, borderRadius: "50%" }}
      // SVG is generated from a hash of `seed`; no user HTML is injected.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
