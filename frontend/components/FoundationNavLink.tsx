"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { cachedCircleInfos, foundationOf, listCircles } from "../lib/member";
import { mySeatIndices } from "../lib/admin";

/**
 * "Foundation" — shown ONLY when the connected wallet holds a Council seat in
 * the root / foundation (World Service) Circle.
 */
export default function FoundationNavLink() {
  const { publicKey } = useWallet();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!publicKey) {
      setShow(false);
      return;
    }
    const me = publicKey.toBase58();
    const check = (circles: any[]) => {
      const f = foundationOf(circles);
      if (!cancelled) setShow(!!f && mySeatIndices(f.seats, me).length > 0);
    };
    check(cachedCircleInfos()); // instant from cache
    listCircles().then(check).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  if (!show) return null;
  return <Link href="/foundation">Foundation</Link>;
}
