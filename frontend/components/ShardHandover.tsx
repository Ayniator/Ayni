"use client";

// Shard handover screen (Trust Platform Epic 11 / F74 + F79).
//
// This is the screen where a key-shard crosses from one device to another, in
// person, at a circle meeting. TWO honest properties are load-bearing here and
// must stay visible in the UI, not buried in a help article (F79):
//
//   1. Two sponsors acting together can reconstruct your master secret WITHOUT
//      you. That is the price of sponsor recovery; the member must read it here.
//   2. A shard never touches a server. The only ways off this screen are an NFC
//      tap to a device physically held against this one, or a QR the other phone
//      scans across the table. There is NO network code path (the codec in
//      lib/shardHandover.ts imports no fetch/socket/chain; Sentinel Layer F
//      asserts it). We do not "promise not to upload" — there is nowhere to
//      upload to.
//
// The bytes are already a SEALED blob (encrypted under a key the receiving
// sponsor does not hold — see lib/shardCustody). This screen only frames them
// for transfer and hands them over.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  encodeShardPayload,
  decodeShardPayload,
  looksLikeShardPayload,
  HANDOVER_MIME,
} from "../lib/shardHandover";

type Mode = "send" | "receive";

// Web NFC (NDEFReader) is present only on some devices/browsers (Chrome on
// Android). It is LOCAL radio, not network — a shard tapped over NFC never
// leaves the room. We feature-detect and fall back to QR when it is absent.
function nfcAvailable(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

export function ShardHandover({
  sealedShard,
  onReceived,
  role,
}: {
  /** The sealed shard to send (send mode). Omit in receive mode. */
  sealedShard?: Uint8Array;
  /** Called with the decoded sealed blob when a shard is received. */
  onReceived?: (sealed: Uint8Array) => void;
  /** Whose shard this is — shapes the disclosure wording. */
  role?: "member" | "sponsor";
}) {
  const [mode, setMode] = useState<Mode>(sealedShard ? "send" : "receive");
  const [status, setStatus] = useState<string>("");
  const [manual, setManual] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const payload = sealedShard ? encodeShardPayload(sealedShard) : "";

  // --- NFC send ----------------------------------------------------------------
  const sendOverNfc = useCallback(async () => {
    if (!nfcAvailable() || !payload) return;
    try {
      setStatus("Hold the two phones together…");
      // @ts-expect-error NDEFReader is not in the base DOM lib
      const writer = new NDEFReader();
      await writer.write({ records: [{ recordType: "mime", mediaType: HANDOVER_MIME, data: new TextEncoder().encode(payload) }] });
      setStatus("Shard sent over NFC. Confirm the other device received it.");
    } catch (e: any) {
      setStatus(`NFC send failed (${e?.message ?? "unknown"}). Use the QR below instead.`);
    }
  }, [payload]);

  // --- NFC receive -------------------------------------------------------------
  const receiveOverNfc = useCallback(async () => {
    if (!nfcAvailable()) return;
    try {
      setStatus("Hold the two phones together…");
      // @ts-expect-error NDEFReader is not in the base DOM lib
      const reader = new NDEFReader();
      const ac = new AbortController();
      abortRef.current = ac;
      await reader.scan({ signal: ac.signal });
      reader.onreading = (ev: any) => {
        for (const rec of ev.message.records) {
          if (rec.mediaType !== HANDOVER_MIME) continue;
          const text = new TextDecoder().decode(rec.data);
          try {
            const sealed = decodeShardPayload(text);
            setStatus("Shard received and verified.");
            onReceived?.(sealed);
            ac.abort();
          } catch (err: any) {
            setStatus(`Bad scan: ${err.message}`);
          }
        }
      };
    } catch (e: any) {
      setStatus(`NFC receive failed (${e?.message ?? "unknown"}). Ask them to show the QR and scan it.`);
    }
  }, [onReceived]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // --- manual / QR-decoded receive --------------------------------------------
  const acceptManual = useCallback(() => {
    try {
      const sealed = decodeShardPayload(manual);
      setStatus("Shard received and verified.");
      onReceived?.(sealed);
    } catch (e: any) {
      setStatus(e.message);
    }
  }, [manual, onReceived]);

  return (
    <div className="shard-handover" style={{ display: "grid", gap: 12 }}>
      {/* F79 — the honest disclosure, on the screen itself */}
      <div
        role="note"
        style={{ border: "1px solid var(--line, #d8b830)", borderRadius: 8, padding: "10px 12px", fontSize: 14, lineHeight: 1.5 }}
      >
        <strong>Before you hand this over.</strong>{" "}
        {role === "member" ? (
          <>This is <em>your</em> shard. Keep it. It is one of three; with any one sponsor&apos;s shard it restores you instantly.</>
        ) : (
          <>Your two sponsors, acting together, can reconstruct your master secret <strong>without you</strong> — that is what makes
          sponsor recovery possible, and it is the trust you are placing in them. Any one sponsor alone can do nothing.</>
        )}{" "}
        A shard is transferred device-to-device only — over NFC or a QR across the table. It never touches a server, and there is
        no way from this screen to send it anywhere but the phone in front of you.
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {sealedShard && (
          <button onClick={() => setMode("send")} aria-pressed={mode === "send"}>Send a shard</button>
        )}
        <button onClick={() => setMode("receive")} aria-pressed={mode === "receive"}>Receive a shard</button>
      </div>

      {mode === "send" && sealedShard && (
        <div style={{ display: "grid", gap: 8 }}>
          {nfcAvailable() ? (
            <button onClick={sendOverNfc}>Tap to send over NFC</button>
          ) : (
            <div style={{ fontSize: 13, opacity: 0.8 }}>NFC isn&apos;t available on this device — use the QR below.</div>
          )}
          <label style={{ fontSize: 13, opacity: 0.8 }}>
            QR payload (render as a QR for the other phone, or read it aloud only in person):
          </label>
          {/* QR-image rendering is a thin presentational layer over this exact
              string; until it is wired, the payload is shown for a QR component
              or an in-person transfer. It is NEVER a link and is never posted. */}
          <textarea readOnly value={payload} rows={4} style={{ fontFamily: "monospace", fontSize: 11, width: "100%" }} />
          <button onClick={() => navigator.clipboard?.writeText(payload)}>Copy payload (device-local only)</button>
        </div>
      )}

      {mode === "receive" && (
        <div style={{ display: "grid", gap: 8 }}>
          {nfcAvailable() && <button onClick={receiveOverNfc}>Receive over NFC</button>}
          <label style={{ fontSize: 13, opacity: 0.8 }}>Or paste the scanned QR payload:</label>
          <textarea
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            rows={4}
            placeholder="AHA-SHARD-1.…"
            style={{ fontFamily: "monospace", fontSize: 11, width: "100%" }}
          />
          <button onClick={acceptManual} disabled={!looksLikeShardPayload(manual)}>Accept shard</button>
        </div>
      )}

      {status && <div aria-live="polite" style={{ fontSize: 13 }}>{status}</div>}
    </div>
  );
}

export default ShardHandover;
