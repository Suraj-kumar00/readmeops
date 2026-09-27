/**
 * Bold and playful: year-in-review energy. Saturated color blocks, huge numbers,
 * a spinning sticker (after Charm's color and GitHub Unwrapped's energy).
 * Tiles keep their colors in both themes; only the text on them adapts.
 */
import { fit, measure, STACK, wrap, type FontKey } from "../fonts/index.ts";
import { esc, r, REDUCED_MOTION, starPath, svgDoc } from "../render/svg.ts";
import { formatDate, shortMonth } from "../util/dates.ts";
import { formatInt } from "../util/format.ts";
import type { CardId, View } from "../view.ts";
import { CARD_WIDTH as W, type Look, type Scheme } from "./types.ts";

const C = {
  cobalt: "#2e55ff", tangerine: "#ff6a2b", pink: "#ff8ccf", sun: "#ffd23f",
  grape: "#7b5cff", mint: "#3ddc97", ink: "#141217", cream: "#fff7ea",
} as const;

const R5: FontKey = "display-500";
const X8: FontKey = "display-800";

const CSS =
  `.r{font-family:${STACK.display};font-weight:500}.x{font-family:${STACK.display};font-weight:800}` +
  "@keyframes pop{from{transform:translateY(8px) scale(.985)}to{transform:none}}" +
  ".tile{transform-box:fill-box;transform-origin:center;animation:pop .6s cubic-bezier(.2,.9,.25,1.2) both}" +
  "@keyframes spin{to{transform:rotate(360deg)}}" +
  REDUCED_MOTION(".tile,.spin");

function T(x: number, y: number, text: string, fill: string, size: number, cls = "r", extra = ""): string {
  return `<text x="${r(x)}" y="${r(y)}" class="${cls}" font-size="${size}" fill="${fill}"${extra}>${esc(text)}</text>`;
}

function tile(x: number, y: number, w: number, h: number, fill: string, delay = 0): string {
  return `<g class="tile" style="animation-delay:${delay}s"><rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="28" fill="${fill}"/>`;
}

/** Display text that shrinks (down to `min`) to fit `width`, then truncates. */
function big(x: number, y: number, text: string, fill: string, max: number, width: number, min = 18, tracking = -0.03): string {
  let size = max;
  while (size > min && measure(X8, text, size, size * tracking) > width) size -= 1;
  return T(x, y, fit(X8, text, size, width, size * tracking), fill, size, "x", ` letter-spacing="${r(size * tracking)}"`);
}

function doc(title: string, h: number, body: string, desc?: string): string {
  return svgDoc({ width: W, height: h, title, ...(desc ? { desc } : {}), fonts: [R5, X8], css: CSS, body });
}

function pill(x: number, y: number, text: string, bg: string, fg: string, size = 15, rot = 0): { svg: string; w: number } {
  const w = measure(R5, text, size) + size * 2;
  const h = size * 2.4;
  const g = rot ? ` transform="rotate(${rot} ${r(x + w / 2)} ${r(y + h / 2)})"` : "";
  return {
    svg: `<g${g}><rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="${r(h / 2)}" fill="${bg}"/>${T(x + size, y + h / 2 + size * 0.36, text, fg, size)}</g>`,
    w,
  };
}

// ------------------------------------------------------------------ cards

function profile(v: View): string {
  const H = 250;
  const s = [tile(0, 0, W, H, C.cobalt)];
  const hi = `Hi, I’m ${v.name}.`;
  s.push(big(40, 104, hi, C.cream, 68, 560, 30));
  if (v.headline) s.push(T(42, 150, fit(R5, v.headline, 22, 560), C.cream, 22, "r", ' fill-opacity=".92"'));
  let x = 42;
  const chips: Array<[string, string, string]> = [];
  v.programs.slice(0, 2).forEach((p, i) => chips.push([p, i === 0 ? C.sun : C.pink, C.ink]));
  if (v.website) chips.push([v.website, C.ink, C.cream]);
  for (const [text, bg, fg] of chips) {
    const label = fit(R5, text, 15, 240);
    const p = pill(x, 176, label, bg, fg, 15);
    if (x + p.w > 600) break;
    s.push(p.svg);
    x += p.w + 10;
  }
  s.push("</g>");
  // sticker: ring of words spinning around a star
  const cx = 718;
  const cy = 118;
  const words = (v.focus.length ? v.focus.slice(0, 4) : ["open source", "github"]).map((t) => t.replace(/-/g, " ").toUpperCase());
  const circumference = 2 * Math.PI * 52 - 3;
  let ring = "";
  for (let i = 0; i < 24; i++) {
    const next = `${ring}${words[i % words.length]} \u2022 `;
    if (measure(X8, next, 14.5, 2.2) > circumference) break;
    ring = next;
  }
  if (!ring) ring = words[0]!.slice(0, 18) + " • ";
  // Spread the leftover arc over the letters so the words go all the way round.
  const spacing = Math.min(8, Math.max(2.2, (circumference - measure(X8, ring, 14.5)) / [...ring].length));
  s.push(`<g transform="rotate(-10 ${cx} ${cy})"><circle cx="${cx}" cy="${cy}" r="74" fill="${C.sun}"/>`);
  s.push(`<defs><path id="ring" d="M${cx - 52},${cy} a52,52 0 1,1 104,0 a52,52 0 1,1 -104,0"/></defs>`);
  s.push(`<g class="spin" style="transform-box:view-box;transform-origin:${cx}px ${cy}px;animation:spin 24s linear infinite"><text class="x" font-size="14.5" fill="${C.ink}" letter-spacing="${r(spacing)}"><textPath href="#ring">${esc(ring)}</textPath></text></g>`);
  s.push(`<path d="${starPath(cx, cy, 30, 13, 8)}" fill="${C.tangerine}"/></g>`);
  return doc(`${v.name} on GitHub`, H, s.join(""), [v.headline, ...v.programs].filter(Boolean).join(". "));
}

function stats(v: View): string {
  const H = 300;
  const st = v.stats;
  const gap = 12;
  const s: string[] = [];
  s.push(tile(0, 0, 352, H, C.tangerine));
  s.push(big(30, 150, formatInt(st.mergedUpstream), C.ink, 150, 300, 60, -0.04));
  const caption = st.mergedUpstream === 1 ? "pull request merged into someone else’s project" : "pull requests merged into other people’s projects";
  wrap(R5, caption, 23, 290, 3).forEach((line, i) => s.push(T(32, 206 + i * 29, line, C.ink, 23)));
  s.push("</g>");
  const x2 = 352 + gap;
  const w2 = W - x2;
  s.push(tile(x2, 0, w2, 144, C.pink, 0.08));
  const stars = formatInt(st.stars);
  s.push(T(x2 + 28, 96, stars, C.ink, 84, "x", ' letter-spacing="-3"'));
  const nx = x2 + 28 + measure(X8, stars, 84, -3) + 18;
  s.push(`<path d="${starPath(nx + 20, 64, 22, 10)}" fill="${C.ink}"/>`);
  s.push(T(nx + 56, 62, "stars across", C.ink, 19));
  s.push(T(nx + 56, 86, `${formatInt(st.repos)} repos`, C.ink, 19));
  s.push("</g>");
  const w3 = (w2 - gap) / 2;
  s.push(tile(x2, 144 + gap, w3, H - 144 - gap, C.sun, 0.16));
  s.push(big(x2 + 26, 144 + gap + 76, formatInt(st.contributions), C.ink, 64, w3 - 52, 30, -0.04));
  s.push(T(x2 + 28, 144 + gap + 112, "contributions this year", C.ink, 17));
  s.push("</g>");
  const x4 = x2 + w3 + gap;
  const lang = v.languages[0]?.name ?? "Code";
  s.push(tile(x4, 144 + gap, w3, H - 144 - gap, C.mint, 0.24));
  s.push(big(x4 + 26, 144 + gap + 64, lang, C.ink, 44, w3 - 52, 20, -0.02));
  const langNote = v.languages[0] ? `#1 language, ${Math.round(v.languages[0].share * 100)}%` : "no language data yet";
  s.push(T(x4 + 28, 144 + gap + 112, fit(R5, langNote, 17, w3 - 54), C.ink, 17));
  s.push("</g>");
  return doc("Year in numbers", H, s.join(""), `${st.mergedUpstream} pull requests merged upstream, ${st.stars} stars, ${st.contributions} contributions this year.`);
}

function activity(v: View): string {
  const H = 260;
  const s = [tile(0, 0, W, H, C.sun)];
  const active = formatInt(v.stats.activeDays);
  s.push(big(34, 132, active, C.ink, 120, 260, 50, -0.04));
  s.push(T(38, 172, v.stats.activeDays === 1 ? "day with a contribution" : "days with a contribution", C.ink, 21));
  s.push(T(38, 200, "in the last 12 months", C.ink, 21, "r", ' fill-opacity=".7"'));
  const months = v.months;
  const mx = Math.max(1, ...months.map((m) => m.total));
  const peak = months.findIndex((m) => m.total === mx && mx > 0);
  const x0 = 330;
  const bw = (W - 40 - x0) / 12;
  months.forEach((m, i) => {
    const h = m.total ? Math.max(14, (m.total / mx) * 150) : 8;
    const x = x0 + i * bw + 4;
    s.push(`<rect x="${r(x)}" y="${r(196 - h)}" width="${r(bw - 8)}" height="${r(h)}" rx="${r(Math.min(12, (bw - 8) / 2))}" fill="${i === peak ? C.tangerine : C.ink}"/>`);
    s.push(T(x + (bw - 8) / 2, 226, shortMonth(m.key).slice(0, 1), C.ink, 15, "x", ' text-anchor="middle"'));
  });
  if (peak >= 0) {
    const px = x0 + peak * bw + 4 + (bw - 8) / 2;
    const label = `${shortMonth(months[peak]!.key)}: ${formatInt(mx)}`;
    const lw = measure(R5, label, 14) + 24;
    const lx = Math.min(W - 30 - lw, Math.max(x0, px - lw / 2));
    s.push(`<rect x="${r(lx)}" y="16" width="${r(lw)}" height="28" rx="14" fill="${C.ink}"/>`);
    s.push(T(lx + 12, 35, label, C.cream, 14));
  }
  s.push("</g>");
  return doc("Contribution activity", H, s.join(""), `${v.stats.activeDays} active days and ${v.stats.contributions} contributions in the last 12 months.`);
}

function upstream(v: View): string {
  const owners = new Map<string, { label: string; merged: number; stars: number }>();
  for (const u of v.upstream) {
    const cur = owners.get(u.owner.toLowerCase()) ?? { label: u.owner, merged: 0, stars: 0 };
    cur.merged += u.merged;
    cur.stars = Math.max(cur.stars, u.stars);
    owners.set(u.owner.toLowerCase(), cur);
  }
  const list = [...owners.values()].sort((a, b) => b.stars - a.stars || b.merged - a.merged).slice(0, 12);
  const fills: Array<[string, string]> = [[C.sun, C.ink], [C.cream, C.ink], [C.mint, C.ink], [C.pink, C.ink], [C.tangerine, C.ink], [C.ink, C.cream]];
  const rot = [-3, 2, -1.5, 3, -2, 1, -2.5, 2.5, -1, 1.5, -3, 2, -1, 2];
  const placed: string[] = [];
  let x = 34;
  let y = 92;
  list.forEach((o, i) => {
    const text = o.merged > 1 ? `${o.label} ×${o.merged}` : o.label;
    const [bg, fg] = fills[i % fills.length]!;
    const p = pill(0, 0, fit(R5, text, 19, 300), bg, fg, 19);
    if (x + p.w > W - 30) {
      x = 34;
      y += 54;
    }
    placed.push(pill(x, y, fit(R5, text, 19, 300), bg, fg, 19, rot[i % rot.length]).svg);
    x += p.w + 12;
  });
  const H = list.length ? y + 46 + 26 : 150;
  const s = [tile(0, 0, W, H, C.grape)];
  s.push(T(34, 62, list.length ? "My PRs landed in" : "My first upstream PR is coming", C.cream, 34, "x", ' letter-spacing="-1"'));
  if (list.length) s.push(T(W - 34, 60, `${formatInt(v.stats.mergedUpstream)} merged`, C.cream, 18, "r", ' text-anchor="end" fill-opacity=".85"'));
  else s.push(T(36, 108, "Merged pull requests to other people’s repositories show up here.", C.cream, 18));
  s.push(...placed, "</g>");
  return doc("Where my pull requests landed", H, s.join(""), list.map((o) => `${o.label} (${o.merged})`).join(", "));
}

function languages(v: View): string {
  const H = 214;
  const langs = v.languages;
  const s = [tile(0, 0, W, H, C.mint)];
  const top = langs[0];
  s.push(big(34, 70, top ? `Mostly ${top.name}` : "No language data yet", C.ink, 44, W - 68, 24));
  const colors = [C.ink, C.cobalt, C.tangerine, C.grape, C.pink, C.sun, C.cream];
  let bx = 34;
  const bw = W - 68;
  langs.forEach((l, i) => {
    const w = l.share * bw;
    if (w < 2) return;
    s.push(`<rect x="${r(bx)}" y="96" width="${r(Math.max(2, w - 4))}" height="34" rx="17" fill="${colors[i % colors.length]}"/>`);
    bx += w;
  });
  let lx = 34;
  langs.forEach((l, i) => {
    const label = `${l.name} ${Math.round(l.share * 100)}%`;
    const w = measure(R5, label, 16) + 34;
    if (lx + w > W - 30) return;
    s.push(`<circle cx="${r(lx + 7)}" cy="165" r="7" fill="${colors[i % colors.length]}" stroke="${C.ink}" stroke-width="${colors[i % colors.length] === C.cream ? 1.5 : 0}"/>`);
    s.push(T(lx + 20, 171, label, C.ink, 16));
    lx += w;
  });
  s.push("</g>");
  return doc("Languages", H, s.join(""), langs.map((l) => `${l.name} ${Math.round(l.share * 100)}%`).join(", "));
}

function repos(v: View): string {
  const items = v.repos.slice(0, 3);
  const H = 250;
  if (!items.length) {
    const s = [tile(0, 0, W, 150, C.pink), T(34, 70, "Repos coming soon", C.ink, 34, "x"), T(36, 106, "Your most starred public repositories show up here.", C.ink, 18), "</g>"];
    return doc("Repositories", 150, s.join(""));
  }
  const gap = 12;
  const tw = (W - gap * (items.length - 1)) / items.length;
  const fills: Array<[string, string]> = [[C.pink, C.ink], [C.cobalt, C.cream], [C.tangerine, C.ink]];
  const s: string[] = [];
  items.forEach((rp, i) => {
    const x = i * (tw + gap);
    const [bg, fg] = fills[i]!;
    s.push(tile(x, 0, tw, H, bg, i * 0.08));
    const name = wrap(X8, rp.name.replace(/[-_]/g, " "), 26, tw - 52, 2);
    name.forEach((line, k) => s.push(T(x + 26, 54 + k * 30, line, fg, 26, "x", ' letter-spacing="-0.6"')));
    wrap(R5, rp.description ?? "", 15, tw - 52, 3).forEach((line, k) => s.push(T(x + 26, 54 + name.length * 30 + 12 + k * 20, line, fg, 15, "r", ' fill-opacity=".85"')));
    s.push(`<path d="${starPath(x + 40, H - 44, 14, 6.2)}" fill="${fg}"/>`);
    s.push(T(x + 62, H - 32, formatInt(rp.stars), fg, 38, "x", ' letter-spacing="-1.5"'));
    s.push("</g>");
  });
  return doc("Top repositories", H, s.join(""), items.map((rp) => `${rp.name}, ${rp.stars} stars`).join("; "));
}

function writing(v: View, scheme: Scheme): string {
  const posts = v.posts.slice(0, 4);
  const H = posts.length ? 104 + posts.length * 58 : 150;
  // An ink tile would vanish on GitHub's dark background, so this tile flips per theme.
  const [bgTile, fgTile] = scheme === "dark" ? [C.cream, C.ink] : [C.ink, C.cream];
  const s = [tile(0, 0, W, H, bgTile)];
  s.push(T(34, 62, posts.length ? "Fresh from the blog" : "Writing goes here", fgTile, 34, "x", ' letter-spacing="-1"'));
  if (!posts.length) {
    s.push(T(36, 106, "Add your blog’s RSS feed with the blog input.", fgTile, 18, "r", ' fill-opacity=".85"'));
  } else if (v.blogHost) {
    s.push(T(W - 34, 60, v.blogHost, fgTile, 16, "r", ' text-anchor="end" fill-opacity=".7"'));
  }
  const chip: Array<[string, string]> = [[C.sun, C.ink], [C.pink, C.ink], [C.mint, C.ink], [C.cobalt, C.cream]];
  posts.forEach((p, i) => {
    const y = 88 + i * 58;
    const [bg, fg] = chip[i % chip.length]!;
    const date = p.date ? formatDate(p.date) : "";
    const d = pill(34, y, date || "new", bg, fg, 14);
    s.push(d.svg);
    s.push(T(34 + d.w + 16, y + 23, fit(R5, p.title, 19, W - 34 - d.w - 16 - 34), fgTile, 19));
  });
  s.push("</g>");
  return doc("Writing", H, s.join(""), posts.map((p) => p.title).join("; "));
}

const CARDS: Record<CardId, (v: View, scheme: Scheme) => string> = { profile, stats, activity, upstream, languages, repos, writing };

export const playful: Look = {
  id: "playful",
  name: "Bold and playful",
  description: "Year-in-review energy: color blocks, huge numbers and a spinning sticker.",
  render: (card, view, scheme) => CARDS[card](view, scheme),
};
