/**
 * Modern terminal: the profile as a TUI session. Panes with titles set into the
 * border and segmented meters (after btop), a key/value context header (after k9s),
 * a selected row and a keybinding footer (after lazygit). No fake window chrome.
 */
import { fit, measure, STACK, type FontKey } from "../fonts/index.ts";
import { esc, mix, r, REDUCED_MOTION, svgDoc } from "../render/svg.ts";
import { formatDate, formatDayMonth, shortMonth } from "../util/dates.ts";
import { compactNumber, formatInt } from "../util/format.ts";
import type { CardId, View } from "../view.ts";
import { CARD_WIDTH as W, type Look, type Scheme } from "./types.ts";

interface Palette {
  bg: string; border: string; title: string; text: string; dim: string; faint: string;
  key: string; head: string; ok: string; warn: string; ramp: string; sel: string; selbar: string;
}

const PAL: Record<Scheme, Palette> = {
  dark: {
    bg: "#0d1015", border: "#2a303a", title: "#ebe6d6", text: "#c6ccd5", dim: "#7b838f", faint: "#1d222b",
    key: "#7ec8e6", head: "#c4a7ff", ok: "#8fd49f", warn: "#f0c47c", ramp: "#f0c47c", sel: "#18202b", selbar: "#7ec8e6",
  },
  light: {
    bg: "#fbfaf6", border: "#d6d2c6", title: "#1f232a", text: "#383d46", dim: "#6c717b", faint: "#e9e6dc",
    key: "#1b6e95", head: "#6a42c8", ok: "#2c7a4c", warn: "#8e6209", ramp: "#1b6e95", sel: "#edf1f5", selbar: "#1b6e95",
  },
};

const M: FontKey = "mono-400";
const B: FontKey = "mono-700";
const FONTS: FontKey[] = [M, B];
const SUP = ["¹", "²", "³", "⁴", "⁵", "⁶", "⁷"];
const CARD_ORDER: CardId[] = ["profile", "stats", "activity", "upstream", "languages", "repos", "writing"];

const CSS =
  `.t{font-family:${STACK.mono};font-weight:400}.b{font-family:${STACK.mono};font-weight:700}` +
  "@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}.cur{animation:blink 1.1s steps(1) infinite}" +
  REDUCED_MOTION(".cur");

// 5x7 bitmap letters for the name banner.
const GLYPHS: Record<string, string> = {
  A: "01110100011000111111100011000110001", B: "11110100011000111110100011000111110", C: "01111100001000010000100001000001111",
  D: "11110100011000110001100011000111110", E: "11111100001000011110100001000011111", F: "11111100001000011110100001000010000",
  G: "01111100001000010011100011000101111", H: "10001100011000111111100011000110001", I: "11111001000010000100001000010011111",
  J: "00111000010000100001100011000101110", K: "10001100101010011000101001001010001", L: "10000100001000010000100001000011111",
  M: "10001110111010110101100011000110001", N: "10001110011010110011100011000110001", O: "01110100011000110001100011000101110",
  P: "11110100011000111110100001000010000", Q: "01110100011000110001101011001001101", R: "11110100011000111110101001001010001",
  S: "01111100001000001110000010000111110", T: "11111001000010000100001000010000100", U: "10001100011000110001100011000101110",
  V: "10001100011000110001100010101000100", W: "10001100011000110101101011010101010", X: "10001100010101000100010101000110001",
  Y: "10001100010101000100001000010000100", Z: "11111000010001000100010001000011111",
};

function T(x: number, y: number, text: string, fill: string, size = 13, cls = "t", extra = ""): string {
  return `<text x="${r(x)}" y="${r(y)}" class="${cls}" font-size="${size}" fill="${fill}"${extra}>${esc(text)}</text>`;
}

function pane(P: Palette, x: number, y: number, w: number, h: number, card: CardId, title: string, right?: string): string {
  const num = SUP[CARD_ORDER.indexOf(card)] ?? "";
  const s = [`<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="6" fill="${P.bg}" stroke="${P.border}"/>`];
  const tx = x + 16;
  const tw = measure(B, title, 12) + 16;
  s.push(`<rect x="${tx - 6}" y="${y - 2}" width="${r(tw + 10)}" height="5" fill="${P.bg}"/>`);
  s.push(T(tx, y + 4, num, P.key, 12));
  s.push(T(tx + 11, y + 4, title, P.head, 12, "b"));
  if (right) {
    const text = fit(M, right, 12, w / 2 - 40);
    const rw = measure(M, text, 12);
    const rx = x + w - 16 - rw;
    s.push(`<rect x="${r(rx - 6)}" y="${y - 2}" width="${r(rw + 12)}" height="5" fill="${P.bg}"/>`);
    s.push(T(rx, y + 4, text, P.dim, 12));
  }
  return s.join("");
}

function check(x: number, y: number, c: string): string {
  return `<path d="M${x} ${y - 4} l3 3 l6 -7" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function footer(P: Palette, y: number, keys: Array<[string, string]>, right: string): string {
  const s = [`<line x1="16" y1="${y - 16.5}" x2="${W - 16}" y2="${y - 16.5}" stroke="${P.border}"/>`];
  let x = 28;
  for (const [k, label] of keys) {
    s.push(T(x, y, k, P.key, 12));
    x += measure(M, k, 12) + 7;
    s.push(T(x, y, label, P.dim, 12));
    x += measure(M, label, 12) + 22;
  }
  s.push(T(W - 44, y, right, P.dim, 12, "t", ' text-anchor="end"'));
  s.push(`<rect class="cur" x="${W - 38}" y="${y - 10}" width="7" height="13" fill="${P.key}"/>`);
  return s.join("");
}

function empty(P: Palette, y: number, text: string): string {
  return T(W / 2, y, text, P.dim, 13, "t", ' text-anchor="middle"');
}

function doc(card: string, h: number, body: string, desc?: string): string {
  return svgDoc({ width: W, height: h, title: card, ...(desc ? { desc } : {}), fonts: FONTS, css: CSS, body });
}

// ------------------------------------------------------------------ cards

function profile(v: View, P: Palette): string {
  const H = 206;
  const s = [pane(P, 8, 10, W - 16, H - 18, "profile", "profile", `@${v.login}`)];
  const letters = [...v.name.toUpperCase()].filter((c) => GLYPHS[c] || c === " ").join("").trim().slice(0, 9);
  let bx = 32;
  if (letters.replace(/ /g, "").length >= 2) {
    const px = 6;
    const cell = 7;
    const cols = letters.length * 6 - 1;
    let col = 0;
    for (const ch of letters) {
      const g = GLYPHS[ch];
      if (g) {
        for (let i = 0; i < 35; i++) {
          if (g[i] !== "1") continue;
          const c = col + (i % 5);
          s.push(`<rect x="${32 + c * cell}" y="${36 + Math.floor(i / 5) * cell}" width="${px}" height="${px}" rx="1" fill="${mix(P.head, P.key, c / Math.max(1, cols - 1))}"/>`);
        }
      }
      col += 6;
    }
    bx = 32 + cols * cell + 26;
  } else {
    s.push(T(32, 74, fit(B, v.name, 30, 300), P.head, 30, "b"));
    bx = 32 + Math.min(300, measure(B, v.name, 30)) + 26;
  }
  const maxw = W - 32 - bx;
  if (v.headline) {
    const m = /^(.*?)\s*(@\S.*)$/.exec(v.headline);
    if (m && m[1]) {
      const a = fit(B, m[1], 15, maxw * 0.62);
      s.push(T(bx, 56, a, P.title, 15, "b"));
      s.push(T(bx + measure(B, a, 15) + 9, 56, fit(M, m[2]!, 15, maxw - measure(B, a, 15) - 9), P.key, 15));
    } else {
      s.push(T(bx, 56, fit(B, v.headline, 15, maxw), P.title, 15, "b"));
    }
  }
  if (v.tagline.length) s.push(T(bx, 78, fit(M, v.tagline.join(" · "), 13, maxw), P.dim, 13));

  s.push(`<line x1="24" y1="104.5" x2="${W - 24}" y2="104.5" stroke="${P.border}" stroke-dasharray="2 4"/>`);
  const since = `${formatDate(v.since)}${v.location ? ` · ${v.location}` : ""}`;
  const left: Array<[string, string, string]> = [];
  if (v.focus.length) left.push(["Focus", v.focus.slice(0, 3).join(" · "), P.text]);
  if (v.focus.length > 3) left.push(["Stack", v.focus.slice(3, 6).join(" · "), P.text]);
  left.push(["Since", since, P.text]);
  const right: Array<[string, string, string]> = [];
  v.programs.slice(0, 2).forEach((p, i) => right.push([i === 0 ? "Programs" : "", p, P.text]));
  if (v.website) right.push(["Web", v.website, P.key]);
  if (right.length < 3) right.push(["Followers", formatInt(v.followers), P.text]);
  const rows = (items: Array<[string, string, string]>, x: number, vx: number, maxv: number) =>
    items.slice(0, 3).forEach(([k, val, tone], i) => {
      const y = 132 + i * 22;
      if (k) s.push(T(x, y, `${k}:`, P.dim, 13));
      s.push(T(vx, y, fit(M, val, 13, maxv), tone, 13));
    });
  rows(left, 32, 110, 300);
  rows(right, 436, 530, W - 32 - 530);
  return doc(`${v.name} on GitHub`, H, s.join(""), [v.headline, ...v.tagline].filter(Boolean).join(". "));
}

function stats(v: View, P: Palette): string {
  const H = 170;
  const st = v.stats;
  const s = [pane(P, 8, 10, W - 16, H - 18, "stats", "stats", "last 12 months")];
  const cols: Array<Array<[string, number, string, string]>> = [
    [
      ["merged upstream", st.mergedUpstream, `into ${formatInt(st.upstreamOwners)} ${st.upstreamOwners === 1 ? "org" : "orgs"}`, P.ok],
      ["stars earned", st.stars, `on ${formatInt(st.repos)} repos`, P.title],
      ["followers", st.followers, "", P.title],
    ],
    [
      ["contributions", st.contributions, "in 12 months", P.title],
      ["active days", st.activeDays, "of 365", P.title],
      ["best streak", st.longestStreak, st.longestStreak === 1 ? "day" : "days", P.title],
    ],
  ];
  cols.forEach((col, c) => {
    const x = c === 0 ? 30 : 440;
    col.forEach(([label, val, ctx, tone], i) => {
      const y = 50 + i * 36;
      s.push(T(x, y, label, P.dim, 13));
      s.push(T(x + 222, y, formatInt(val), tone, 13, "b", ' text-anchor="end"'));
      if (ctx) s.push(T(x + 236, y, ctx, P.dim, 12));
    });
  });
  s.push(`<line x1="${W / 2 + 0.5}" y1="34" x2="${W / 2 + 0.5}" y2="${H - 30}" stroke="${P.border}" stroke-dasharray="2 4"/>`);
  return doc("GitHub stats", H, s.join(""), `${st.mergedUpstream} pull requests merged into other projects, ${st.stars} stars, ${st.contributions} contributions in the last year.`);
}

function activity(v: View, P: Palette): string {
  const H = 196;
  const s = [pane(P, 8, 10, W - 16, H - 18, "activity", "activity", `${formatInt(v.stats.contributions)} contributions · 52 weeks`)];
  const weeks = v.weeks;
  const mx = Math.max(1, ...weeks.map((w) => w.total));
  const rows = 9;
  const dx = 560 / Math.max(1, weeks.length - 1);
  const x0 = 32;
  const base = 148;
  weeks.forEach((w, i) => {
    const h = w.total === 0 ? 0 : Math.max(1, Math.round((Math.log1p(w.total) / Math.log1p(mx)) * rows));
    const cx = x0 + i * dx;
    for (let k = 0; k < rows; k++) {
      const cy = base - k * 11;
      if (k < h) s.push(`<circle cx="${r(cx)}" cy="${cy}" r="2.7" fill="${mix(P.key, P.head, k / (rows - 1))}"/>`);
      else s.push(`<circle cx="${r(cx)}" cy="${cy}" r="1.4" fill="${P.faint}"/>`);
    }
    if (i > 0 && w.start.slice(5, 7) !== weeks[i - 1]!.start.slice(5, 7)) {
      s.push(T(cx - 4, 172, shortMonth(w.start).toLowerCase(), P.dim, 11));
    }
  });
  const facts: Array<[string, string, string]> = [
    ["busiest wk", v.busiestWeek ? formatInt(v.busiestWeek.total) : "0", v.busiestWeek ? formatDayMonth(v.busiestWeek.start) : ""],
    ["best day", v.bestDay ? formatInt(v.bestDay.count) : "0", v.bestDay ? formatDayMonth(v.bestDay.date) : ""],
    ["active", formatInt(v.stats.activeDays), "days"],
    ["streak", formatInt(v.stats.currentStreak), "now"],
  ];
  s.push(`<line x1="620.5" y1="34" x2="620.5" y2="170" stroke="${P.border}" stroke-dasharray="2 4"/>`);
  facts.forEach(([k, val, ctx], i) => {
    const y = 54 + i * 28;
    s.push(T(640, y, k, P.dim, 12));
    s.push(T(752, y, val, P.title, 13, "b", ' text-anchor="end"'));
    s.push(T(760, y, ctx, P.dim, 12));
  });
  return doc("Contribution activity", H, s.join(""), `${v.stats.contributions} contributions in the last 52 weeks.`);
}

function upstream(v: View, P: Palette): string {
  const rows = v.upstream.slice(0, 7);
  const H = rows.length ? 88 + rows.length * 26 + 30 : 150;
  const st = v.stats;
  const s = [pane(P, 8, 10, W - 16, H - 18, "upstream", "upstream", `${formatInt(st.mergedUpstream)} merged · ${formatInt(st.upstreamOwners)} orgs`)];
  if (!rows.length) {
    s.push(empty(P, 84, "no merged pull requests to other people’s repositories yet"));
    return doc("Merged pull requests upstream", H, s.join(""));
  }
  const hdr = (x: number, text: string, anchor = "") => s.push(T(x, 46, text, P.dim, 11, "t", anchor));
  hdr(50, "REPOSITORY");
  hdr(306, "STARS", ' text-anchor="end"');
  hdr(324, "LATEST MERGED PULL REQUEST");
  hdr(730, "PRS", ' text-anchor="end"');
  hdr(W - 30, "MERGED", ' text-anchor="end"');
  rows.forEach((u, i) => {
    const y = 74 + i * 26;
    if (i === 0) {
      s.push(`<rect x="16" y="${y - 17}" width="${W - 32}" height="25" rx="3" fill="${P.sel}"/>`);
      s.push(`<rect x="16" y="${y - 17}" width="2" height="25" fill="${P.selbar}"/>`);
    }
    s.push(check(28, y - 1, P.ok));
    s.push(T(50, y, fit(M, u.repo, 13, 200), P.key, 13, i === 0 ? "b" : "t"));
    s.push(T(306, y, compactNumber(u.stars), P.warn, 13, "t", ' text-anchor="end"'));
    s.push(T(324, y, fit(M, u.latest.title, 13, 370), i === 0 ? P.title : P.text, 13));
    s.push(T(730, y, String(u.merged), P.dim, 13, "t", ' text-anchor="end"'));
    s.push(T(W - 30, y, formatDayMonth(u.latest.mergedAt.slice(0, 10)), P.dim, 13, "t", ' text-anchor="end"'));
  });
  s.push(footer(P, H - 22, [["<enter>", "open"], ["</>", "filter"], ["<tab>", "next pane"]], "ranked by project and PR size"));
  return doc("Merged pull requests upstream", H, s.join(""), `${st.mergedUpstream} pull requests merged into ${st.upstreamRepos} repositories owned by others.`);
}

function languages(v: View, P: Palette): string {
  const langs = v.languages;
  const H = langs.length ? 58 + langs.length * 25 + 8 : 130;
  const s = [pane(P, 8, 10, W - 16, H - 18, "languages", "languages", "by code size")];
  if (!langs.length) {
    s.push(empty(P, 72, "no language data yet"));
    return doc("Languages", H, s.join(""));
  }
  const top = Math.max(...langs.map((l) => l.share));
  const seg = 6;
  const gap = 2;
  const n = 64;
  langs.forEach((l, i) => {
    const y = 50 + i * 25;
    const other = l.name === "Other";
    s.push(T(30, y, fit(M, l.name, 13, 140), other ? P.dim : P.text, 13));
    const lit = Math.max(1, Math.round((l.share / top) * n));
    for (let k = 0; k < n; k++) {
      const fill = k < lit ? (other ? P.dim : mix(P.ok, P.ramp, k / (n - 1))) : P.faint;
      s.push(`<rect x="${190 + k * (seg + gap)}" y="${y - 10}" width="${seg}" height="11" rx="1" fill="${fill}"/>`);
    }
    s.push(T(W - 30, y, `${(l.share * 100).toFixed(l.share < 0.1 ? 1 : 0)}%`, P.title, 12, "b", ' text-anchor="end"'));
  });
  return doc("Languages", H, s.join(""), langs.map((l) => `${l.name} ${(l.share * 100).toFixed(0)}%`).join(", "));
}

function repos(v: View, P: Palette): string {
  const rows = v.repos;
  const H = rows.length ? 84 + rows.length * 26 : 130;
  const s = [pane(P, 8, 10, W - 16, H - 18, "repos", "repositories", "by stars")];
  if (!rows.length) {
    s.push(empty(P, 72, "no public repositories yet"));
    return doc("Repositories", H, s.join(""));
  }
  const hdr = (x: number, text: string, anchor = "") => s.push(T(x, 46, text, P.dim, 11, "t", anchor));
  hdr(30, "NAME");
  hdr(240, "DESCRIPTION");
  hdr(612, "LANG");
  hdr(746, "STARS", ' text-anchor="end"');
  hdr(W - 30, "FORKS", ' text-anchor="end"');
  rows.forEach((rp, i) => {
    const y = 74 + i * 26;
    if (i === 0) {
      s.push(`<rect x="16" y="${y - 17}" width="${W - 32}" height="25" rx="3" fill="${P.sel}"/>`);
      s.push(`<rect x="16" y="${y - 17}" width="2" height="25" fill="${P.selbar}"/>`);
    }
    s.push(T(30, y, fit(M, rp.name, 13, 196), P.key, 13, i === 0 ? "b" : "t"));
    s.push(T(240, y, fit(M, rp.description ?? "", 13, 358), i === 0 ? P.title : P.text, 13));
    s.push(T(612, y, fit(M, (rp.language ?? "").toLowerCase(), 12, 84), P.dim, 12));
    s.push(T(746, y, formatInt(rp.stars), P.warn, 13, "t", ' text-anchor="end"'));
    s.push(T(W - 30, y, formatInt(rp.forks), P.dim, 13, "t", ' text-anchor="end"'));
  });
  return doc("Top repositories", H, s.join(""), rows.map((rp) => `${rp.name}, ${rp.stars} stars`).join("; "));
}

function writing(v: View, P: Palette): string {
  const rows = v.posts;
  const H = rows.length ? 50 + rows.length * 26 + 8 : 130;
  const s = [pane(P, 8, 10, W - 16, H - 18, "writing", "writing", v.blogHost ?? "blog")];
  if (!rows.length) {
    s.push(empty(P, 72, "add your blog feed with the blog input to list posts here"));
    return doc("Writing", H, s.join(""));
  }
  rows.forEach((p, i) => {
    const y = 48 + i * 26;
    s.push(T(30, y, p.date ?? "", P.dim, 13));
    s.push(T(146, y, fit(M, p.title, 13, W - 146 - 40), i === 0 ? P.title : P.text, 13, i === 0 ? "b" : "t"));
  });
  return doc("Writing", H, s.join(""), rows.map((p) => p.title).join("; "));
}

const CARDS: Record<CardId, (v: View, P: Palette) => string> = { profile, stats, activity, upstream, languages, repos, writing };

export const terminal: Look = {
  id: "terminal",
  name: "Modern terminal",
  description: "TUI panes with titles in the border, segmented meters and a dot-matrix activity graph.",
  render: (card, view, scheme) => CARDS[card](view, PAL[scheme]),
};
