"use client";

// Epic 6 / F62 — draw your stone-mark.
//
// A dependency-free canvas: an equilateral-triangle frame (the Cavern's carving
// stone) with freehand drawing CLIPPED to inside the triangle, a clear button,
// and onSave(dataUrl) that exports a small (<=128px) PNG — the same size bound
// as profile.ts fileToAvatarDataUrl, so it drops straight into the avatar slot.
//
// The mark is a symbol, not a face. Who is allowed to see it is decided
// elsewhere (Epic 5's VisibilityPolicy.avatar, enforced on the read path); this
// component only lets the owner make their own mark on their own device.

import { useEffect, useRef, useState } from "react";
import { NEUTRAL_SILHOUETTE } from "../lib/stonemark";

const SIZE = 256; // drawing resolution; exported mark is downscaled to <=128
const EXPORT_PX = 128;

// Equilateral triangle, apex up, inset in a SIZE×SIZE box.
function trianglePath(s: number) {
  const pad = s * 0.08;
  const w = s - pad * 2;
  const h = (Math.sqrt(3) / 2) * w;
  const yTop = (s - h) / 2;
  const cx = s / 2;
  const apex: [number, number] = [cx, yTop];
  const left: [number, number] = [cx - w / 2, yTop + h];
  const right: [number, number] = [cx + w / 2, yTop + h];
  const p = new Path2D();
  p.moveTo(apex[0], apex[1]);
  p.lineTo(right[0], right[1]);
  p.lineTo(left[0], left[1]);
  p.closePath();
  return p;
}

function strokeColor(): string {
  if (typeof window === "undefined") return "#222";
  const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return dark ? "#e8e8e8" : "#222";
}

export interface StoneMarkProps {
  onSave: (dataUrl: string) => void;
  onCancel?: () => void;
  /** Optional existing mark to start from (not drawn onto — just a hint the
   *  parent may show elsewhere). The canvas always starts blank. */
  height?: number;
}

export function StoneMark({ onSave, onCancel, height = 256 }: StoneMarkProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const tri = useRef<Path2D>(trianglePath(SIZE));
  const ink = useRef<string>("#222");

  // (re)draw the empty triangle frame
  function paintFrame(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = ink.current;
    ctx.globalAlpha = 0.5;
    ctx.stroke(tri.current);
    ctx.restore();
  }

  useEffect(() => {
    ink.current = strokeColor();
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) paintFrame(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE];
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    drawing.current = true;
    ctx.save();
    ctx.clip(tri.current); // ink stays inside the stone
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 6;
    ctx.strokeStyle = ink.current;
    const [x, y] = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!dirty) setDirty(true);
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.restore(); // drop the clip
  }

  function clear() {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) paintFrame(ctx);
    setDirty(false);
  }

  function save() {
    const src = canvasRef.current;
    if (!src) return;
    // downscale to a small PNG data URL, like fileToAvatarDataUrl's bound
    const out = document.createElement("canvas");
    out.width = EXPORT_PX;
    out.height = EXPORT_PX;
    const octx = out.getContext("2d");
    if (!octx) return;
    octx.drawImage(src, 0, 0, EXPORT_PX, EXPORT_PX);
    onSave(out.toDataURL("image/png"));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        style={{
          width: height,
          height,
          touchAction: "none",
          cursor: "crosshair",
          borderRadius: 8,
          border: "1px solid rgba(128,128,128,0.3)",
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={clear} disabled={!dirty}>
          Clear
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" onClick={save} disabled={!dirty}>
          Save stone-mark
        </button>
      </div>
    </div>
  );
}

export interface StoneMarkViewProps {
  /** A saved mark, or undefined ⇒ the neutral silhouette (a bare page, not a
   *  lock). Callers gate ENTITLEMENT via Epic 5 before passing a real mark. */
  dataUrl?: string;
  height?: number;
  alt?: string;
}

/** Read-only render of a saved stone-mark (or the neutral silhouette). */
export function StoneMarkView({ dataUrl, height = 96, alt = "stone-mark" }: StoneMarkViewProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl || NEUTRAL_SILHOUETTE}
      alt={alt}
      width={height}
      height={height}
      style={{ width: height, height, objectFit: "contain", display: "block" }}
    />
  );
}
