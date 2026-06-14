"use client";

// Policy: any wallet holding one of the 7 Council seats in ANY Circle MUST have
// messaging enabled (so members and the federation can always reach a servant).
//
// We cannot *cryptographically* force-enable it for someone else — a wallet's
// messaging key is derived from that wallet's own signature (deriveBoxKeypair),
// so only the seat-holder can publish it. The closest enforcement is this:
// whenever a connected seat-holder is detected without a published messaging
// key, show a persistent, non-dismissable banner that enables it in one click
// (one signature). See BACKLOG F32 / "seat-holders must enable messaging".

import { useCallback, useEffect, useState } from "react";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { listCircles } from "../lib/member";
import { mySeatIndices } from "../lib/admin";
import { isRegistered, registerMessagingKey } from "../lib/messaging";

export default function SeatMessagingGate() {
  const { publicKey, connected, signMessage } = useWallet();
  const wallet = useAnchorWallet();
  const me = publicKey?.toBase58();

  const [needs, setNeeds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!me) {
      setNeeds(false);
      return;
    }
    try {
      if (await isRegistered(me)) {
        setNeeds(false);
        return;
      }
      const circles = await listCircles();
      const holdsSeat = circles.some((c) => mySeatIndices(c.seats, me).length > 0);
      setNeeds(holdsSeat);
    } catch {
      /* network hiccup — try again next mount */
    }
  }, [me]);

  useEffect(() => {
    check();
  }, [check]);

  if (!connected || !needs) return null;

  async function enable() {
    if (!wallet || !signMessage) return;
    setBusy(true);
    setErr(null);
    try {
      await registerMessagingKey(wallet, signMessage as (m: Uint8Array) => Promise<Uint8Array>);
      window.dispatchEvent(new Event("aha:inbox-read"));
      setNeeds(false);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="seat-msg-gate" role="alert">
      <div className="seat-msg-gate-inner">
        <span>
          <b>You hold a Council seat.</b> Servants must be reachable — enable encrypted messaging so members can write to you.
          {err && <span className="seat-msg-gate-err"> · {err}</span>}
        </span>
        <button className="btn btn-sm" onClick={enable} disabled={busy}>
          {busy ? "Enabling…" : "Enable messaging"}
        </button>
      </div>
    </div>
  );
}
