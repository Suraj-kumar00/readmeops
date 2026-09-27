/**
 * Clean product UI: an analytics page in miniature. Geist type, hairline borders
 * and one accent color, after Vercel's Geist system and Linear. Numbers use
 * proportional figures so the measured widths match what renders.
 */
import { fit, measure, STACK, wrap, type FontKey } from "../fonts/index.ts";
import { esc, hueOf, linePath, r, REDUCED_MOTION, starPath, svgDoc } from "../render/svg.ts";
import { formatDate, formatDayMonth, shortMonth } from "../util/dates.ts";
import { compactNumber, formatInt } from "../util/format.ts";
import type { CardId, View } from "../view.ts";
import { CARD_WIDTH as W, type Look, type Scheme } from "./types.ts";

interface Palette {
  card: string; border: string; text: string; sub: string; muted: string; grid: string;
  accent: string; accent2: string; track: string; pill: string; dark: boolean;
}

const PAL: Record<Scheme, Palette> = {
  dark: {
    card: "#0f1114", border: "#23272e", text: "#ededee", sub: "#a8adb5", muted: "#7c828c", grid: "#1b1f25",
    accent: "#8b93ff", accent2: "#5c63d9", track: "#1a1e24", pill: "#15181d", dark: true,
  },
  light: {
    card: "#ffffff", border: "#e4e6ea", text: "#16181c", sub: "#4b5058", muted: "#6e747d", grid: "#f0f1f3",
    accent: "#4b53d6", accent2: "#a4a9f2", track: "#eff0f3", pill: "#f7f7f8", dark: false,
  },
};

const R4: FontKey = "sans-400";
const R5: FontKey = "sans-500";
const R6: FontKey = "sans-600";
const MO: FontKey = "code-400";

const CSS =
  `.r{font-family:${STACK.sans};font-weight:400}.m{font-family:${STACK.sans};font-weight:500}` +
  `.s{font-family:${STACK.sans};font-weight:600}` +
  `.mono{font-family:${STACK.code};font-weight:400}` +
  "@keyframes breathe{0%,100%{opacity:1}50%{opacity:.55}}.peak{animation:breathe 2.4s ease-in-out infinite}" +
  REDUCED_MOTION(".peak");

function T(x: number, y: number, text: string, fill: string, size: number, cls = "r", extra = ""): string {
  return `<text x="${r(x)}" y="${r(y)}" class="${cls}" font-size="${size}" fill="${fill}"${extra}>${esc(text)}</text>`;
}

function card(P: Palette, h: number): string {
  return `<rect x=".5" y=".5" width="${W - 1}" height="${h - 1}" rx="12" fill="${P.card}" stroke="${P.border}"/>`;
}

function heading(P: Palette, title: string, detail: string, right?: string): string {
  const s = [T(24, 40, title, P.text, 15, "m")];
  s.push(T(24 + measure(R5, title, 15) + 10, 40, fit(R4, detail, 15, W - 300 - measure(R5, title, 15)), P.muted, 15));
  if (right) s.push(T(W - 24, 40, right, P.muted, 12.5, "r", ' text-anchor="end"'));
  return s.join("");
}

function doc(title: string, h: number, fonts: FontKey[], body: string, desc?: string): string {
  return svgDoc({ width: W, height: h, title, ...(desc ? { desc } : {}), fonts, css: CSS, body });
}

function emptyNote(P: Palette, y: number, text: string): string {
  return T(24, y, text, P.muted, 13.5);
}

function spark(values: number[], x: number, y: number, w: number, h: number, color: string): string {
  if (values.length < 2 || Math.max(...values) === 0) return "";
  const mx = Math.max(...values);
  const pts = values.map((v, i): [number, number] => [x + (i * w) / (values.length - 1), y + h - (v / mx) * h]);
  const line = linePath(pts);
  return `<path d="${line} L${r(x + w)} ${r(y + h)} L${r(x)} ${r(y + h)} Z" fill="${color}" fill-opacity=".14"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`;
}

function avatar(v: View, P: Palette, cx: number, cy: number, rad: number): string {
  if (v.avatar) {
    return `<defs><clipPath id="av"><circle cx="${cx}" cy="${cy}" r="${rad}"/></clipPath></defs>` +
      `<image href="${esc(v.avatar)}" x="${cx - rad}" y="${cy - rad}" width="${rad * 2}" height="${rad * 2}" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${rad - 0.5}" fill="none" stroke="${P.border}"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${P.pill}" stroke="${P.border}"/>` + T(cx, cy + rad * 0.34, v.initial, P.accent, rad * 0.9, "s", ' text-anchor="middle"');
}

// ------------------------------------------------------------------ cards

function profile(v: View, P: Palette): string {
  const H = 148;
  const s = [card(P, H), avatar(v, P, 60, 74, 36)];
  const x = 116;
  const name = fit(R6, v.name, 28, 330, -0.5);
  const handle = fit(R4, `@${v.login}`, 15, 200);
  const handleX = x + measure(R6, name, 28, -0.5) + 12;
  s.push(T(x, 58, name, P.text, 28, "s", ' letter-spacing="-0.5"'));
  s.push(T(handleX, 58, handle, P.muted, 15));
  // Top right, above the name row: use whatever width the name and handle leave free.
  const meta = [v.location, `on GitHub since ${v.since.slice(0, 4)}`].filter(Boolean).join(" · ");
  const room = W - 24 - (handleX + measure(R4, handle, 15)) - 24;
  s.push(T(W - 24, 40, fit(R4, meta, 12.5, room), P.muted, 12.5, "r", ' text-anchor="end"'));
  const line = [v.headline, ...v.tagline.slice(0, 1)].filter(Boolean).join(" · ");
  if (line) s.push(T(x, 84, fit(R4, line, 15, W - x - 24), P.sub, 15));
  let px = x;
  for (const label of [...v.programs.slice(0, 2), ...(v.website ? [v.website] : [])]) {
    const text = fit(R5, label, 12.5, 260);
    const w = measure(R5, text, 12.5) + 32;
    if (px + w > W - 24) break;
    s.push(`<rect x="${r(px + 0.5)}" y="104.5" width="${r(w)}" height="25" rx="12.5" fill="${P.pill}" stroke="${P.border}"/>`);
    s.push(`<circle cx="${r(px + 13)}" cy="117" r="3" fill="${P.accent}"/>`);
    s.push(T(px + 22, 121.5, text, P.sub, 12.5, "m"));
    px += w + 8;
  }
  return doc(`${v.name} on GitHub`, H, [R4, R5, R6], s.join(""), line || undefined);
}

function stats(v: View, P: Palette): string {
  const H = 124;
  const st = v.stats;
  const s = [card(P, H)];
  const cols: Array<[string, number, string, number[] | null]> = [
    ["Merged upstream", st.mergedUpstream, `into ${formatInt(st.upstreamOwners)} organizations`, v.months.map((m) => m.merged)],
    ["Stars earned", st.stars, `across ${formatInt(st.repos)} repositories`, null],
    ["Contributions", st.contributions, "last 12 months", v.weeks.map((w) => w.total)],
    ["Active days", st.activeDays, `longest streak ${formatInt(st.longestStreak)} days`, null],
  ];
  const cw = W / 4;
  cols.forEach(([label, val, ctx, series], i) => {
    const x = i * cw + 24;
    if (i) s.push(`<line x1="${r(i * cw)}" y1="20" x2="${r(i * cw)}" y2="${H - 20}" stroke="${P.border}"/>`);
    s.push(T(x, 38, label, P.muted, 13));
    const num = formatInt(val);
    s.push(T(x, 78, num, P.text, 34, "m", ' letter-spacing="-0.8"'));
    s.push(T(x, 101, fit(R4, ctx, 12, cw - 40), P.muted, 12));
    const sx = x + measure(R5, num, 34, -0.8) + 14;
    if (series && sx < x + cw - 70) s.push(spark(series, sx, 52, x + cw - 44 - sx, 30, P.accent));
  });
  return doc("GitHub stats", H, [R4, R5], s.join(""), `${st.mergedUpstream} pull requests merged upstream, ${st.stars} stars, ${st.contributions} contributions in the last year.`);
}

function activity(v: View, P: Palette): string {
  const H = 244;
  const s = [card(P, H), heading(P, "Contributions", `${formatInt(v.stats.contributions)} in the last year`, "Weekly")];
  const vals = v.weeks.map((w) => w.total);
  const sorted = [...vals].sort((a, b) => b - a);
  const cap = Math.max(4, (sorted[1] ?? sorted[0] ?? 4) * 1.35);
  const x0 = 56;
  const y0 = 64;
  const cw = 760;
  const ch = 136;
  for (const g of [0, 0.5, 1]) {
    const gy = y0 + ch - g * ch;
    s.push(`<line x1="${x0}" y1="${r(gy + 0.5)}" x2="${x0 + cw}" y2="${r(gy + 0.5)}" stroke="${P.grid}"/>`);
    s.push(T(x0 - 10, gy + 4, String(Math.round(g * cap)), P.muted, 11, "mono", ' text-anchor="end"'));
  }
  const bw = cw / Math.max(1, vals.length);
  const peak = vals.indexOf(Math.max(...vals));
  vals.forEach((val, i) => {
    if (val === 0) return;
    const h = (Math.min(val, cap) / cap) * ch;
    const bx = x0 + i * bw + 1.5;
    s.push(`<rect${i === peak ? ' class="peak"' : ""} x="${r(bx)}" y="${r(y0 + ch - h)}" width="${r(bw - 3)}" height="${r(h)}" rx="2" fill="${i === peak ? P.accent : P.accent2}"/>`);
    if (val > cap) {
      s.push(`<path d="M${r(bx - 1)} ${y0 + 13} l${r(bw - 1)} -4 M${r(bx - 1)} ${y0 + 17} l${r(bw - 1)} -4" stroke="${P.card}" stroke-width="2"/>`);
      const label = `${formatInt(val)} · week of ${formatDayMonth(v.weeks[i]!.start)}`;
      const lw = measure(R5, label, 12);
      const lx = bx + bw + 8 + lw > x0 + cw ? bx - 8 - lw : bx + bw + 8;
      s.push(T(lx, y0 + 12, label, P.text, 12, "m"));
    }
  });
  v.weeks.forEach((w, i) => {
    if (i > 0 && w.start.slice(5, 7) !== v.weeks[i - 1]!.start.slice(5, 7)) s.push(T(x0 + i * bw + 1, y0 + ch + 22, shortMonth(w.start), P.muted, 11, "mono"));
  });
  if (v.stats.contributions === 0) s.push(emptyNote(P, y0 + ch / 2, "No public contributions in the last year yet."));
  return doc("Weekly contributions", H, [R4, R5, MO], s.join(""), `${v.stats.contributions} contributions in the last year.`);
}

function upstream(v: View, P: Palette): string {
  const rows = v.upstream.slice(0, 6);
  const H = rows.length ? 86 + rows.length * 50 : 110;
  const st = v.stats;
  const s = [card(P, H), heading(P, "Merged upstream", `${formatInt(st.mergedUpstream)} pull requests into ${formatInt(st.upstreamOwners)} organizations`, rows.length ? "ranked by project and PR size" : undefined)];
  if (!rows.length) {
    s.push(emptyNote(P, 76, "No merged pull requests to other people’s repositories yet."));
    return doc("Merged pull requests upstream", H, [R4, R5], s.join(""));
  }
  rows.forEach((u, i) => {
    const y = 64 + i * 50;
    s.push(`<line x1="24" y1="${y + 0.5}" x2="${W - 24}" y2="${y + 0.5}" stroke="${P.border}"/>`);
    const owner = u.owner;
    const h = hueOf(owner);
    s.push(`<rect x="24" y="${y + 11}" width="28" height="28" rx="7" fill="hsl(${h} 45% ${P.dark ? "18%" : "94%"})"/>`);
    s.push(T(38, y + 30, owner[0]!.toUpperCase(), `hsl(${h} 70% ${P.dark ? "72%" : "38%"})`, 13, "s", ' text-anchor="middle"'));
    const repoText = fit(R5, u.repo, 14, 420);
    const split = repoText.startsWith(`${owner}/`);
    const repoSvg = split ? `${esc(owner)}<tspan fill="${P.muted}">/</tspan>${esc(repoText.slice(owner.length + 1))}` : esc(repoText);
    s.push(`<text x="66" y="${y + 22}" class="m" font-size="14" fill="${P.text}">${repoSvg}</text>`);
    if (u.stars > 0) {
      const sx = 66 + measure(R5, repoText, 14) + 12;
      s.push(`<path d="${starPath(sx + 5, y + 17.5, 5.5, 2.4)}" fill="${P.muted}"/>`);
      s.push(T(sx + 14, y + 22, compactNumber(u.stars), P.muted, 12.5));
    }
    s.push(T(66, y + 40, fit(R4, u.latest.title, 12.5, 560), P.muted, 12.5));
    s.push(T(W - 24, y + 22, formatDate(u.latest.mergedAt), P.muted, 12.5, "r", ' text-anchor="end"'));
    if (u.merged > 1) {
      const label = `${u.merged} merged`;
      const w = measure(R5, label, 11.5) + 16;
      s.push(`<rect x="${r(W - 24 - w)}" y="${y + 29}" width="${r(w)}" height="18" rx="9" fill="${P.track}"/>`);
      s.push(T(W - 24 - w / 2, y + 41.5, label, P.sub, 11.5, "m", ' text-anchor="middle"'));
    }
  });
  return doc("Merged pull requests upstream", H, [R4, R5, R6], s.join(""), `${st.mergedUpstream} pull requests merged into ${st.upstreamRepos} repositories owned by others.`);
}

function languages(v: View, P: Palette): string {
  const H = 96;
  const s = [card(P, H), T(24, 36, "Languages", P.text, 15, "m"), T(W - 24, 36, "by code size", P.muted, 12.5, "r", ' text-anchor="end"')];
  const langs = v.languages;
  if (!langs.length) {
    s.push(emptyNote(P, 66, "No language data yet."));
    return doc("Languages", H, [R4, R5], s.join(""));
  }
  const ramp = [1, 0.78, 0.6, 0.46, 0.35, 0.27, 0.2];
  let bx = 24;
  langs.forEach((l, i) => {
    const w = l.share * (W - 48);
    if (w >= 1) s.push(`<rect x="${r(bx)}" y="50" width="${r(Math.max(1, w - 2))}" height="8" rx="2" fill="${P.accent}" fill-opacity="${ramp[i] ?? 0.2}"/>`);
    bx += w;
  });
  let lx = 24;
  langs.forEach((l, i) => {
    const pct = `${(l.share * 100).toFixed(l.share < 0.1 ? 1 : 0)}%`;
    const w = measure(R4, `${l.name} ${pct}`, 12.5) + 34;
    if (lx + w > W - 16) return;
    s.push(`<circle cx="${r(lx + 4)}" cy="77" r="4" fill="${P.accent}" fill-opacity="${ramp[i] ?? 0.2}"/>`);
    s.push(`<text x="${r(lx + 13)}" y="81" class="r" font-size="12.5" fill="${P.sub}">${esc(l.name)} <tspan fill="${P.muted}">${pct}</tspan></text>`);
    lx += w;
  });
  return doc("Languages", H, [R4, R5], s.join(""), langs.map((l) => `${l.name} ${(l.share * 100).toFixed(0)}%`).join(", "));
}

function forkIcon(x: number, y: number, c: string): string {
  return `<g fill="none" stroke="${c}" stroke-width="1.3"><circle cx="${x}" cy="${y - 8}" r="1.8"/><circle cx="${x + 8}" cy="${y - 8}" r="1.8"/><circle cx="${x + 4}" cy="${y + 1}" r="1.8"/><path d="M${x} ${y - 6} v1.5 a2 2 0 0 0 2 2 h4 a2 2 0 0 0 2 -2 v-1.5 M${x + 4} ${y - 2.5} v1.7"/></g>`;
}

function repos(v: View, P: Palette): string {
  const items = v.repos;
  const rowsN = Math.ceil(items.length / 3);
  const H = items.length ? 60 + rowsN * 124 : 110;
  const s = [card(P, H), heading(P, "Repositories", "most starred")];
  if (!items.length) {
    s.push(emptyNote(P, 76, "No public repositories yet."));
    return doc("Repositories", H, [R4, R5], s.join(""));
  }
  const gw = (W - 48 - 24) / 3;
  items.forEach((rp, i) => {
    const x = 24 + (i % 3) * (gw + 12);
    const y = 60 + Math.floor(i / 3) * 124;
    s.push(`<rect x="${r(x + 0.5)}" y="${y + 0.5}" width="${r(gw - 1)}" height="111" rx="10" fill="${P.pill}" stroke="${P.border}"/>`);
    s.push(T(x + 16, y + 28, fit(R5, rp.name, 14, gw - 32), P.text, 14, "m"));
    wrap(R4, rp.description ?? "No description", 12.5, gw - 32, 2).forEach((line, k) => s.push(T(x + 16, y + 50 + k * 18, line, P.muted, 12.5)));
    let fx = x + 16;
    if (rp.language) {
      s.push(`<circle cx="${r(fx + 4)}" cy="${y + 94}" r="4" fill="${rp.languageColor ?? P.accent}"/>`);
      const lang = fit(R4, rp.language, 12, gw / 2 - 30);
      s.push(T(fx + 13, y + 98, lang, P.sub, 12));
      fx += measure(R4, lang, 12) + 28;
    }
    s.push(`<path d="${starPath(fx + 5, y + 93.5, 5.5, 2.4)}" fill="${P.muted}"/>`);
    s.push(T(fx + 14, y + 98, formatInt(rp.stars), P.sub, 12, "m"));
    fx += measure(R5, formatInt(rp.stars), 12) + 30;
    s.push(forkIcon(fx, y + 98, P.muted));
    s.push(T(fx + 14, y + 98, formatInt(rp.forks), P.sub, 12, "m"));
  });
  return doc("Top repositories", H, [R4, R5], s.join(""), items.map((rp) => `${rp.name}, ${rp.stars} stars`).join("; "));
}

function writing(v: View, P: Palette): string {
  const posts = v.posts;
  const H = posts.length ? 64 + posts.length * 44 + 12 : 110;
  const s = [card(P, H), heading(P, "Writing", v.blogHost ?? "latest posts")];
  if (!posts.length) {
    s.push(emptyNote(P, 76, "Add your blog’s RSS feed with the blog input to list posts here."));
    return doc("Writing", H, [R4, R5], s.join(""));
  }
  posts.forEach((p, i) => {
    const y = 64 + i * 44;
    s.push(`<line x1="24" y1="${y + 0.5}" x2="${W - 24}" y2="${y + 0.5}" stroke="${P.border}"/>`);
    s.push(T(24, y + 28, fit(R5, p.title, 14.5, W - 24 - 160), P.text, 14.5, "m"));
    s.push(T(W - 48, y + 28, p.date ? formatDate(p.date) : "", P.muted, 12.5, "r", ' text-anchor="end"'));
    s.push(`<path d="M${W - 34} ${y + 27} l6 -6 M${W - 33} ${y + 21} h5 v5" fill="none" stroke="${P.muted}" stroke-width="1.4" stroke-linecap="round"/>`);
  });
  return doc("Writing", H, [R4, R5], s.join(""), posts.map((p) => p.title).join("; "));
}

const CARDS: Record<CardId, (v: View, P: Palette) => string> = { profile, stats, activity, upstream, languages, repos, writing };

export const clean: Look = {
  id: "clean",
  name: "Clean product UI",
  description: "Analytics-page precision: Geist type, hairline borders, one accent color.",
  render: (card, view, scheme) => CARDS[card](view, PAL[scheme]),
};
