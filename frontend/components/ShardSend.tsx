"use client";

// ShardSend (Epic 11 / F74) — show one sealed shard to the device across the
// table, as a QR code and (where the hardware exists) an NFC tap.
//
// LOCKED POSITIONS (CLAUDE.md) THIS COMPONENT UPHOLDS:
//   - In-person device-to-device only. The QR is drawn locally by the `qrcode`
//     library onto a <canvas>; the NFC write is local radio. There is NO fetch,
//     NO XHR, NO socket, NO URL anywhere in this file — a shard has nowhere to
//     go except the phone physically in front of this one.
//   - The payload is OPAQUE. We render the encoded string exactly as given and
//     never parse, log, or persist it. No localStorage/sessionStorage/IndexedDB.
//   - Nothing here lists or counts shards; one payload in, one QR out.

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { HANDOVER_MIME } from "../lib/shardHandover";
import { useT } from "./SettingsProvider";

// Web NFC is Chrome-on-Android territory; everywhere else the QR carries the
// handover. NDEFReader isn't in the base DOM lib, so we type the sliver we use.
type NdefWriterLike = {
  write(message: {
    records: Array<{ recordType: string; mediaType?: string; data?: Uint8Array }>;
  }): Promise<void>;
};
type NdefWriterCtor = new () => NdefWriterLike;

function getNdefCtor(): NdefWriterCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { NDEFReader?: NdefWriterCtor };
  return "NDEFReader" in window && w.NDEFReader ? w.NDEFReader : null;
}

export default function ShardSend({
  payload,
  label,
  onDone,
}: {
  /** The encoded shard payload ("AHA-SHARD-1.…") — treated as an opaque string. */
  payload: string;
  /** Optional heading, e.g. "Shard for your first sponsor". */
  label?: string;
  /** Called when the holder confirms the in-person handover is complete. */
  onDone?: () => void;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [qrError, setQrError] = useState("");
  const [nfcReady, setNfcReady] = useState(false);
  const [nfcStatus, setNfcStatus] = useState("");
  const [nfcBusy, setNfcBusy] = useState(false);

  // Feature-detect NFC after mount (SSR renders without it, then hydrates).
  useEffect(() => {
    setNfcReady(getNdefCtor() !== null);
  }, []);

  // Draw the QR locally. Always dark modules on a white tile — scanners need
  // that contrast, so the tile stays white even in dark theme.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !payload) return;
    let cancelled = false;
    setQrError("");
    QRCode.toCanvas(canvas, payload, {
      errorCorrectionLevel: "M",
      margin: 3, // quiet zone
      width: 300,
      color: { dark: "#111111", light: "#ffffff" },
    }).catch(() => {
      if (!cancelled) {
        setQrError(t("shard.send.qrError"));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [payload, t]);

  const sendOverNfc = useCallback(async () => {
    const Ctor = getNdefCtor();
    if (!Ctor || !payload) return;
    setNfcBusy(true);
    setNfcStatus(t("shard.send.nfcHold"));
    try {
      const writer = new Ctor();
      await writer.write({
        records: [
          {
            recordType: "mime",
            mediaType: HANDOVER_MIME,
            // The payload is base64url ASCII; encode the exact string as bytes.
            data: new TextEncoder().encode(payload),
          },
        ],
      });
      setNfcStatus(t("shard.send.nfcSent"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("shard.send.unknownError");
      setNfcStatus(`${t("shard.send.nfcFailPre")}${msg}${t("shard.send.nfcFailSuf")}`);
    } finally {
      setNfcBusy(false);
    }
  }, [payload, t]);

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      {label && <strong>{label}</strong>}

      <p className="muted sm" style={{ margin: 0 }}>
        {t("shard.send.intro")}
      </p>

      {/* White tile behind the canvas so the QR scans in dark theme too. */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          padding: 12,
          display: "flex",
          justifyContent: "center",
          maxWidth: 340,
        }}
      >
        <canvas
          ref={canvasRef}
          aria-label={t("shard.send.qrAria")}
          style={{ width: "100%", maxWidth: 300, minWidth: 260, height: "auto" }}
        />
      </div>
      {qrError && (
        <div role="alert" className="sm" style={{ color: "var(--muted)" }}>
          {qrError}
        </div>
      )}

      {nfcReady && (
        <div style={{ display: "grid", gap: 6 }}>
          <button className="btn btn-sm" onClick={sendOverNfc} disabled={nfcBusy}>
            {t("shard.send.nfcBtn")}
          </button>
          {nfcStatus && (
            <div aria-live="polite" className="muted sm">
              {nfcStatus}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gap: 4 }}>
        <span className="muted sm">
          {t("shard.send.typeInstead")}
        </span>
        <code
          className="mono sm"
          style={{
            display: "block",
            wordBreak: "break-all",
            whiteSpace: "pre-wrap",
            padding: "8px 10px",
            border: "1px solid var(--border, #ccc)",
            borderRadius: 8,
            userSelect: "all",
          }}
        >
          {payload}
        </code>
      </div>

      <button className="btn" onClick={() => onDone?.()}>
        {t("shard.send.doneBtn")}
      </button>
    </div>
  );
}

export { ShardSend };
