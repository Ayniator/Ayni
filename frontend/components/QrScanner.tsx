"use client";

// A reusable camera QR scanner, extracted from the pattern proven in
// ShardReceive.tsx so the presence handoff (and anything later) can offer
// "scan" without re-deriving the getUserMedia / BarcodeDetector / cleanup dance.
//
// DELIBERATELY NARROW, matching ShardReceive's stance:
//   * Native BarcodeDetector only — no bundled decoder library. If the browser
//     has none, the whole control renders NOTHING (returns null), so a device
//     that cannot scan shows no dead button rather than a broken one. Paste is
//     always the fallback and lives in the caller.
//   * Rear camera (`facingMode: "environment"`), ~5 fps snapshots.
//   * The stream is stopped on decode, on stop, and on unmount — a camera left
//     live is both a battery drain and a privacy tell.
//
// It reads a code and hands the raw string to `onScan`; it never parses,
// validates, or transmits. What the string means is the caller's business.

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "./SettingsProvider";

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return "BarcodeDetector" in window && w.BarcodeDetector ? w.BarcodeDetector : null;
}

/** True when this browser can scan at all — callers may use it to decide
 *  whether to even mention the option. */
export function cameraScanSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    getBarcodeDetectorCtor() !== null
  );
}

export default function QrScanner({
  onScan,
  label,
}: {
  onScan: (value: string) => void;
  label?: string;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pollRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const doneRef = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState("");

  // Decide support after mount only — `navigator`/`window` are client-only and
  // reading them during render would differ between server and first client
  // pass and trip hydration.
  useEffect(() => setSupported(cameraScanSupported()), []);

  const stop = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  // Stop on unmount — a live camera outliving the card is the exact privacy
  // tell this app avoids elsewhere.
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    const Detector = getBarcodeDetectorCtor();
    if (!Detector || scanning) return;
    setError("");
    doneRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
        return;
      }
      video.srcObject = stream;
      await video.play();
      setScanning(true);

      const detector = new Detector({ formats: ["qr_code"] });
      pollRef.current = window.setInterval(async () => {
        if (busyRef.current || doneRef.current) return;
        const v = videoRef.current;
        const canvas = canvasRef.current;
        if (!v || !canvas || v.videoWidth === 0) return;
        busyRef.current = true;
        try {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(v, 0, 0);
            const codes = await detector.detect(canvas);
            const hit = codes.find((c) => c.rawValue);
            if (hit) {
              doneRef.current = true;
              onScan(hit.rawValue);
              stop();
            }
          }
        } catch {
          // one failed detect is fine; the next tick retries
        } finally {
          busyRef.current = false;
        }
      }, 200); // ~5 fps
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      stop();
    }
  }, [onScan, scanning, stop]);

  if (!supported) return null; // no dead button on a device that cannot scan

  return (
    <div style={{ marginTop: 6 }}>
      {!scanning ? (
        <button type="button" className="btn btn-sm btn-ghost" onClick={start}>
          {label ?? t("qr.scan")}
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted style={{ width: "100%", maxWidth: 320, borderRadius: 8, background: "#000" }} />
          <button type="button" className="btn btn-sm btn-ghost" onClick={stop}>
            {t("qr.stop")}
          </button>
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {error && <p className="error sm" style={{ margin: "4px 0 0" }}>{t("qr.cameraFail")} {error}</p>}
    </div>
  );
}
