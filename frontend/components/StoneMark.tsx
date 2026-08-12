"use client";

// Epic 6 / F62 — draw your stone-mark.
//
// A dependency-free drawing canvas: an equilateral-triangle frame (the Cavern's
// carving stone) with freehand drawing BOUNDED to inside the triangle,
// adjustable stroke, undo, clear, and onSave(dataUrl) that exports a small,
// size-capped raster — the same slot the photo avatar fills, so it drops
// straight in (see lib/profile.ts fileToAvatarDataUrl).
//
// PRIVACY (the whole point of the feature): this is an identity that reveals
// nothing biometric. The member draws a sign; no camera, no file picker, no
// upload, no network call exists anywhere in this component. What is exported
// is a rendering of the member's own strokes — the stroke *dynamics* (timing,
// velocity, pressure) are discarded at commit and never stored, so the mark is
// a symbol and not a handwriting sample. It leaves the device only as the
// member's own avatar payload, under Epic 5's avatar visibility tier, on
// exactly the terms the photo path already has.
//
// The mark is a symbol, not a face. Who is allowed to see it is decided
// elsewhere (Epic 5's VisibilityPolicy.avatar, enforced on the read path); this
// component only lets the owner make their own mark on their own device.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_STROKES,
  NEUTRAL_SILHOUETTE,
  STONE_DRAW_PX,
  STONE_MARK_MAX_BYTES,
  STROKE_W_DEFAULT,
  STROKE_W_MAX,
  STROKE_W_MIN,
  clampStrokeWidth,
  clampToTriangle,
  dataUrlByteLength,
  encodeStoneMark,
  insideTriangle,
  renderStoneMark,
  simplifyStroke,
  type Pt,
  type StoneStroke,
} from "../lib/stonemark";

const SIZE = STONE_DRAW_PX; // logical drawing resolution (unit space × SIZE)

export interface StoneMarkProps {
  onSave: (dataUrl: string) => void;
  onCancel?: () => void;
  /** On-screen size of the canvas, in CSS pixels. The export size is fixed and
   *  independent of this (see lib/stonemark.ts STONE_MARK_EXPORT_PX). */
  height?: number;
}

export function StoneMark({ onSave, onCancel, height = 256 }: StoneMarkProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<StoneStroke[]>([]);
  const live = useRef<StoneStroke | null>(null);
  const [version, setVersion] = useState(0); // bumps when the committed mark changes
  const [width, setWidth] = useState(STROKE_W_DEFAULT);
  const [encoded, setEncoded] = useState<string | undefined>(undefined);

  const bump = () => setVersion((v) => v + 1);

  /** Repaint the whole mark from geometry. Committed strokes + the one in
   *  progress; no layer stack, so undo/clear cannot drift out of sync. */
  const paint = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = typeof window === "undefined" ? 1 : Math.min(3, window.devicePixelRatio || 1);
    const px = Math.round(SIZE * dpr);
    if (c.width !== px) {
      c.width = px;
      c.height = px;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const all = live.current ? [...strokes.current, live.current] : strokes.current;
    renderStoneMark(ctx, SIZE, all);
  }, []);

  useEffect(() => {
    paint();
  }, [paint, version]);

  // Keep a ready-to-save encoding in step with the mark, so "Save" is instant
  // and the member can see what it will cost before committing to it.
  useEffect(() => {
    if (!strokes.current.length) {
      setEncoded(undefined);
      return;
    }
    setEncoded(encodeStoneMark(strokes.current));
  }, [version]);

  function unitPos(e: React.PointerEvent<HTMLCanvasElement>): Pt {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  /** Append a sampled point to the live stroke. Points outside the triangle are
   *  not recorded: the stroke is cut at the boundary (projected onto the nearest
   *  edge) and a fresh one starts when the pointer comes back in. The triangle
   *  is a bound on the geometry, not merely a mask over it. */
  function addPoint(p: Pt) {
    const cur = live.current;
    if (!cur) return;
    if (insideTriangle(p)) {
      cur.pts.push(p);
      return;
    }
    if (cur.pts.length) {
      cur.pts.push(clampToTriangle(p)); // land exactly on the edge, then stop
      commit();
      // a fresh (empty) stroke, so re-entering the stone continues the gesture
      live.current = { w: width, pts: [] };
    }
  }

  function commit() {
    const cur = live.current;
    live.current = null;
    if (!cur || !cur.pts.length) return;
    if (strokes.current.length >= MAX_STROKES) return; // cheap by construction
    strokes.current.push({ w: cur.w, pts: simplifyStroke(cur.pts) });
    bump();
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = unitPos(e);
    live.current = { w: width, pts: insideTriangle(p) ? [p] : [] };
    paint();
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!live.current) return;
    addPoint(unitPos(e));
    paint();
  }

  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!live.current) return;
    const p = unitPos(e);
    if (insideTriangle(p) && live.current.pts.length === 0) live.current.pts.push(p);
    commit();
    paint();
  }

  function undo() {
    if (!strokes.current.length) return;
    strokes.current.pop();
    bump();
  }

  function clear() {
    if (!strokes.current.length) return;
    strokes.current = [];
    live.current = null;
    bump();
  }

  function save() {
    const url = encoded ?? encodeStoneMark(strokes.current);
    if (url) onSave(url);
  }

  const empty = strokes.current.length === 0;
  const bytes = useMemo(() => (encoded ? dataUrlByteLength(encoded) : 0), [encoded]);

  return (
    <div className="stone-wrap">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Stone-mark drawing surface: draw your sign inside the triangle"
        className="stone-canvas"
        style={{ width: height, height }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />

      <div className="stone-tools">
        <label className="sm stone-widthbox">
          Stroke
          <input
            className="stone-width"
            type="range"
            min={STROKE_W_MIN}
            max={STROKE_W_MAX}
            step={0.001}
            value={width}
            aria-label="Stroke thickness"
            onChange={(e) => setWidth(clampStrokeWidth(Number(e.target.value)))}
          />
          {/* true-to-scale preview: the same fraction of the canvas edge */}
          <span
            className="stone-dot"
            style={{ width: Math.max(2, width * height), height: Math.max(2, width * height) }}
          />
        </label>
        <button type="button" className="btn btn-sm btn-ghost" onClick={undo} disabled={empty}>
          Undo
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={clear} disabled={empty}>
          Clear
        </button>
        {onCancel && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={save} disabled={empty || !encoded}>
          Save stone-mark
        </button>
      </div>

      <p className="muted sm stone-note">
        Draw a sign, not a face — anything you like, as long as it is yours. It stays on this
        device and is shown only to the people your avatar visibility lets in.
        {bytes > 0 && ` (${(bytes / 1024).toFixed(1)} KB of a ${Math.round(STONE_MARK_MAX_BYTES / 1024)} KB limit.)`}
      </p>
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
