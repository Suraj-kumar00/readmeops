/** Small SVG helpers shared by the looks. */
import { fontFaces, type FontKey } from "../fonts/index.ts";
import { escapeXml } from "../util/text.ts";

export const esc = escapeXml;

/** Rounds coordinates so the markup stays small and stable. */
export function r(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export interface SvgDocOptions {
  width: number;
  height: number;
  title: string;
  desc?: string;
  fonts: readonly FontKey[];
  css: string;
  body: string;
}

export function svgDoc(o: SvgDocOptions): string {
  const desc = o.desc ? `<desc>${esc(o.desc)}</desc>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}" role="img" aria-label="${esc(o.title)}">` +
    `<title>${esc(o.title)}</title>${desc}<style>${fontFaces(o.fonts)}${o.css}</style>${o.body}</svg>`
  );
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** Linear blend between two hex colors. */
export function mix(a: string, b: string, t: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  return "#" + ca.map((x, i) => Math.round(x + (cb[i]! - x) * Math.min(1, Math.max(0, t))).toString(16).padStart(2, "0")).join("");
}

/** Stable hue from a string, for monograms. */
export function hueOf(value: string): number {
  let h = 0;
  for (const ch of value.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** A path that draws a five or eight point star centered at (cx, cy). */
export function starPath(cx: number, cy: number, outer: number, inner: number, points = 5, rotation = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI * i) / points + rotation;
    const rad = i % 2 === 0 ? outer : inner;
    pts.push(`${r(cx + rad * Math.sin(a))} ${r(cy - rad * Math.cos(a))}`);
  }
  return `M${pts.join(" L")} Z`;
}

/** Line path through points; returns "" for fewer than two points. */
export function linePath(points: Array<[number, number]>): string {
  if (points.length < 2) return "";
  return "M" + points.map(([x, y]) => `${r(x)} ${r(y)}`).join(" L");
}

export const REDUCED_MOTION = (selectors: string) => `@media (prefers-reduced-motion:reduce){${selectors}{animation:none!important}}`;
