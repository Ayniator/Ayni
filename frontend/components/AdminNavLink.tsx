"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { listCircles } from "../lib/member";
import { mySeatIndices } from "../lib/admin";
import { useT } from "./SettingsProvider";

/**
 * "Administration of my Circle" — rendered ONLY when the connected wallet holds
 * an active Council seat in at least one Circle. Hidden otherwise (and when no
 * wallet is connected), per the seat-gated design.
 */
export default function AdminNavLink() {
  const { publicKey } = useWallet();
  const [isSeat, setIsSeat] = useState(false);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    if (!publicKey) {
      setIsSeat(false);
      return;
    }
    const me = publicKey.toBase58();
    listCircles()
      .then((circles) => {
        if (!cancelled) setIsSeat(circles.some((c) => mySeatIndices(c.seats, me).length > 0));
      })
      .catch(() => {
        if (!cancelled) setIsSeat(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  if (!isSeat) return null;
  return <Link href="/admin">{t("nav.admin")}</Link>;
}
