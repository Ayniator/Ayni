"use client";

// ShardReceive (Epic 11 / F74) — take a sealed shard from the device across the
// table. Three intake paths, ALL local to this device:
//
//   1. Camera QR scan — getUserMedia into a <video>, decoded by the browser's
//      native BarcodeDetector on canvas snapshots (~5 fps). If the browser has
//      no BarcodeDetector, the camera path is hidden entirely: we deliberately
//      do NOT ship a JS QR-decoding dependency for it (minimal deps, and no
//      third-party code touching a shard frame). NFC or manual entry covers it.
//   2. NFC tap — NDEFReader scan, matching our private MIME record (or a text
//      record that carries the recognisable prefix).
//   3. Manual entry — the sending screen shows the same code as text under its
//      QR; the holder types or pastes it here.
//
// LOCKED POSITIONS (CLAUDE.md) THIS COMPONENT UPHOLDS:
//   - No network code path: no fetch/XHR/socket/URL. Camera frames and NFC
//     records are read and dropped; the only output is onPayload(text) to the
//     caller.
//   - The payload is OPAQUE: it is validated for frame integrity
//     (decodeShardPayload) and passed through as the encoded string. Never
//     parsed further, never logged, never stored (no localStorage/session
//     Storage/IndexedDB), never displayed beyond what the holder typed.
//   - Nothing here lists or counts shards.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeShardPayload,
  looksLikeShardPayload,
  HANDOVER_MIME,
  HANDOVER_PREFIX,
} from "../lib/shardHandover";
import { useT } from "./SettingsProvider";

// --- slivers of Web APIs not in the base DOM lib ------------------------------

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
};
type BarcodeDetectorCtor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return "BarcodeDetector" in window && w.BarcodeDetector
    ? w.BarcodeDetector
    : null;
}

type NdefRecordLike = {
  recordType: string;
  mediaType?: string;
  data?: BufferSource | null;
};
type NdefReadingEventLike = { message: { records: NdefRecordLike[] } };
type NdefReaderLike = {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((event: NdefReadingEventLike) => void) | null;
};
type NdefReaderCtor = new () => NdefReaderLike;

function getNdefCtor(): NdefReaderCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { NDEFReader?: NdefReaderCtor };
  return "NDEFReader" in window && w.NDEFReader ? w.NDEFReader : null;
}

// -----------------------------------------------------------------------------

export default function ShardReceive({
  onPayload,
  label,
}: {
  /** Called exactly once per accepted shard, with the validated encoded payload
   *  string ("AHA-SHARD-1.…") — still sealed, still opaque. */
  onPayload: (text: string) => void;
  /** Optional heading, e.g. "Receive the member's shard". */
  label?: string;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pollRef = useRef<number | null>(null);
  const detectBusyRef = useRef(false);
  const acceptedRef = useRef(false);
  const nfcAbortRef = useRef<AbortController | null>(null);

  const [cameraSupported, setCameraSupported] = useState(false);
  const [nfcSupported, setNfcSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [nfcListening, setNfcListening] = useState(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  // Feature-detect after mount so SSR markup stays stable.
  useEffect(() => {
    setCameraSupported(
      getBarcodeDetectorCtor() !== null &&
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia
    );
    setNfcSupported(getNdefCtor() !== null);
  }, []);

  const stopCamera = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  const stopNfc = useCallback(() => {
    nfcAbortRef.current?.abort();
    nfcAbortRef.current = null;
    setNfcListening(false);
  }, []);

  /** Single funnel for all three intake paths. Returns true if accepted.
   *  `quiet` suppresses the "not a shard" error for scan loops, where random
   *  QR codes / NFC records in the environment are expected and just skipped. */
  const accept = useCallback(
    (text: string, quiet: boolean): boolean => {
      if (acceptedRef.current) return false;
      const trimmed = text.trim();
      if (!looksLikeShardPayload(trimmed)) {
        if (!quiet) setError(t("shard.receive.notShard"));
        return false;
      }
      try {
        decodeShardPayload(trimmed); // integrity check only; result is discarded
      } catch (e) {
        setError(e instanceof Error ? e.message : t("shard.receive.damaged"));
        return false;
      }
      acceptedRef.current = true;
      setError("");
      setStatus(t("shard.receive.received"));
      stopCamera();
      stopNfc();
      onPayload(trimmed);
      return true;
    },
    [onPayload, stopCamera, stopNfc, t]
  );

  // --- (a) camera QR scan ------------------------------------------------------

  const startCamera = useCallback(async () => {
    const Detector = getBarcodeDetectorCtor();
    if (!Detector || scanning) return;
    setError("");
    setStatus("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        return;
      }
      video.srcObject = stream;
      await video.play();
      setScanning(true);

      const detector = new Detector({ formats: ["qr_code"] });
      pollRef.current = window.setInterval(async () => {
        if (detectBusyRef.current || acceptedRef.current) return;
        const v = videoRef.current;
        const canvas = snapshotRef.current;
        if (!v || !canvas || v.videoWidth === 0) return;
        detectBusyRef.current = true;
        try {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(v, 0, 0);
            const codes = await detector.detect(canvas);
            for (const code of codes) {
              if (accept(code.rawValue, true)) break;
            }
          }
        } catch {
          // A single failed detect is fine; the next tick tries again.
        } finally {
          detectBusyRef.current = false;
        }
      }, 200); // ~5 fps
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("shard.receive.unknownError");
      setError(`${t("shard.receive.cameraFailPre")}${msg}${t("shard.receive.cameraFailSuf")}`);
      stopCamera();
    }
  }, [accept, scanning, stopCamera, t]);

  // --- (b) NFC read ------------------------------------------------------------

  const startNfc = useCallback(async () => {
    const Ctor = getNdefCtor();
    if (!Ctor || nfcListening) return;
    setError("");
    setStatus(t("shard.receive.nfcHold"));
    try {
      const reader = new Ctor();
      const ac = new AbortController();
      nfcAbortRef.current = ac;
      await reader.scan({ signal: ac.signal });
      setNfcListening(true);
      reader.onreading = (ev) => {
        for (const rec of ev.message.records) {
          if (!rec.data) continue;
          const isOurs =
            (rec.recordType === "mime" && rec.mediaType === HANDOVER_MIME) ||
            rec.recordType === "text";
          if (!isOurs) continue;
          const bytes =
            rec.data instanceof ArrayBuffer
              ? new Uint8Array(rec.data)
              : new Uint8Array(rec.data.buffer, rec.data.byteOffset, rec.data.byteLength);
          const text = new TextDecoder().decode(bytes);
          if (accept(text, true)) return;
        }
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("shard.receive.unknownError");
      setError(`${t("shard.receive.nfcFailPre")}${msg}${t("shard.receive.nfcFailSuf")}`);
      setStatus("");
      stopNfc();
    }
  }, [accept, nfcListening, stopNfc, t]);

  // Always release camera and NFC on unmount.
  useEffect(() => {
    return () => {
      stopCamera();
      stopNfc();
    };
  }, [stopCamera, stopNfc]);

  // --- (c) manual entry --------------------------------------------------------

  const acceptManual = useCallback(() => {
    accept(manual, false);
  }, [accept, manual]);

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      {label && <strong>{label}</strong>}

      <p className="muted sm" style={{ margin: 0 }}>
        {t("shard.receive.intro")}
      </p>

      {/* (a) camera scan — shown only when the browser can decode QR natively */}
      {cameraSupported && (
        <div style={{ display: "grid", gap: 6 }}>
          {!scanning ? (
            <button className="btn btn-sm" onClick={startCamera}>
              {t("shard.receive.scanBtn")}
            </button>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={stopCamera}>
              {t("shard.receive.stopCameraBtn")}
            </button>
          )}
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label={t("shard.receive.cameraAria")}
            style={{
              width: "100%",
              maxWidth: 340,
              borderRadius: 12,
              display: scanning ? "block" : "none",
              background: "#000",
            }}
          />
          {/* off-screen snapshot surface for BarcodeDetector */}
          <canvas ref={snapshotRef} style={{ display: "none" }} aria-hidden="true" />
          {scanning && (
            <span className="muted sm">
              {t("shard.receive.pointCamera")}
            </span>
          )}
        </div>
      )}

      {/* (b) NFC */}
      {nfcSupported && (
        <div style={{ display: "grid", gap: 6 }}>
          {!nfcListening ? (
            <button className="btn btn-sm" onClick={startNfc}>
              {t("shard.receive.nfcBtn")}
            </button>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={stopNfc}>
              {t("shard.receive.stopNfcBtn")}
            </button>
          )}
        </div>
      )}

      {/* (c) manual entry — always available */}
      <div style={{ display: "grid", gap: 6 }}>
        <label className="muted sm" htmlFor="shard-manual-entry">
          {t("shard.receive.manualLabel")}
        </label>
        <textarea
          id="shard-manual-entry"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          rows={4}
          placeholder={`${HANDOVER_PREFIX}…`}
          spellCheck={false}
          autoComplete="off"
          className="mono sm"
          style={{ width: "100%", resize: "vertical" }}
        />
        <button
          className="btn btn-sm"
          onClick={acceptManual}
          disabled={!looksLikeShardPayload(manual)}
        >
          {t("shard.receive.acceptBtn")}
        </button>
      </div>

      {error && (
        <div role="alert" className="sm" style={{ color: "#c0392b" }}>
          {error}
        </div>
      )}
      {status && (
        <div aria-live="polite" className="muted sm">
          {status}
        </div>
      )}
    </div>
  );
}

export { ShardReceive };
