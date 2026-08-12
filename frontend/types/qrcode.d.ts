// Minimal typings for the `qrcode` package (v1.5.x, no @types published).
// Only the client-side surface we actually use is declared: toCanvas/toDataURL.
// Rendering is 100% local — the library draws pixels; nothing leaves the device.

declare module "qrcode" {
  export interface QRCodeRenderOptions {
    /** Error-correction level. */
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    /** Quiet-zone width in modules (default 4). */
    margin?: number;
    /** Rendered width in pixels. */
    width?: number;
    /** Scale factor (px per module) — ignored when width is set. */
    scale?: number;
    color?: {
      /** Dark-module color, e.g. "#000000ff". */
      dark?: string;
      /** Light-module color, e.g. "#ffffffff". */
      light?: string;
    };
  }

  export function toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: QRCodeRenderOptions
  ): Promise<HTMLCanvasElement>;

  export function toDataURL(
    text: string,
    options?: QRCodeRenderOptions
  ): Promise<string>;

  const QRCode: {
    toCanvas: typeof toCanvas;
    toDataURL: typeof toDataURL;
  };
  export default QRCode;
}
