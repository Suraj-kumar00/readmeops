/** Embedded fonts: @font-face rules and text metrics from the real advance widths. */
import { CODEPOINTS, FACES } from "./data.ts";

export type FontKey = keyof typeof FACES & string;

const INDEX = new Map<number, number>(CODEPOINTS.map((cp, i) => [cp, i]));

/** CSS family stacks; the embedded face comes first, system fonts catch other scripts. */
export const STACK = {
  mono: "'RO Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
  sans: "'RO Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
  code: "'RO Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
  cond: "'RO Cond','Roboto Condensed','Arial Narrow',ui-sans-serif,sans-serif",
  display: "'RO Display',ui-rounded,ui-sans-serif,system-ui,sans-serif",
} as const;

export function fontFaces(keys: readonly FontKey[]): string {
  return [...new Set(keys)]
    .map((k) => {
      const f = FACES[k]!;
      return `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${f.woff2}) format('woff2')}`;
    })
    .join("");
}

/** Width of `text` in px at `size`, with optional letter spacing in px. */
export function measure(key: FontKey, text: string, size: number, letterSpacing = 0): number {
  const f = FACES[key]!;
  const fallback = f.family === "RO Mono" || f.family === "RO Code" ? 600 : Math.round(f.upm * 0.56);
  let units = 0;
  let n = 0;
  for (const ch of text) {
    const i = INDEX.get(ch.codePointAt(0)!);
    const adv = i === undefined ? 0 : f.advances[i]!;
    units += adv > 0 ? adv : fallback;
    n++;
  }
  return (units * size) / f.upm + letterSpacing * Math.max(0, n - 1);
}

/** Truncates with an ellipsis so the text fits `maxWidth`. */
export function fit(key: FontKey, text: string, size: number, maxWidth: number, letterSpacing = 0): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (measure(key, clean, size, letterSpacing) <= maxWidth) return clean;
  const chars = [...clean];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = chars.slice(0, mid).join("").trimEnd() + "…";
    if (measure(key, candidate, size, letterSpacing) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "…" : chars.slice(0, lo).join("").replace(/[\s,.;:\-|/]+$/, "") + "…";
}

/** Greedy word wrap into at most `maxLines`; the last line is truncated if needed. */
export function wrap(key: FontKey, text: string, size: number, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let i = 0; i < words.length; i++) {
    const next = current ? `${current} ${words[i]}` : words[i]!;
    if (measure(key, next, size) <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = words[i]!;
    if (lines.length === maxLines - 1) {
      current = words.slice(i).join(" ");
      break;
    }
  }
  if (current) lines.push(current);
  const out = lines.slice(0, maxLines);
  const last = out.length - 1;
  if (last >= 0) out[last] = fit(key, out[last]!, size, maxWidth);
  return out;
}
