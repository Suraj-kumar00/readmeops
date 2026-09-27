/**
 * Ops dashboard: the profile as an observability dashboard. Stat panels with area
 * sparklines, a state timeline, LCD bar gauges and a logs panel (after Grafana),
 * and uptime bars (after GitHub's status page).
 */
import { fit, measure, STACK, type FontKey } from "../fonts/index.ts";
import { esc, linePath, r, REDUCED_MOTION, svgDoc } from "../render/svg.ts";
import { formatDate, shortMonth } from "../util/dates.ts";
import { compactNumber, formatInt } from "../util/format.ts";
import type { CardId, View } from "../view.ts";
import { CARD_WIDTH as W, type Look, type Scheme } from "./types.ts";

interface Palette {
  canvas: string; panel: string; border: string; text: string; muted: string; grid: string; track: string; chip: string;
  green: string; yellow: string; blue: string; purple: string; orange: string; red: string;
}

const PAL: Record<Scheme, Palette> = {
  dark: {
    canvas: "#111217", panel: "#181b1f", border: "#272b31", text: "#d8d9dc", muted: "#8f939b", grid: "#23272d", track: "#21252b", chip: "#1f2328",
    green: "#6ccf8e", yellow: "#f2c94c", blue: "#6aa8ff", purple: "#c291ff", orange: "#ff9d5c", red: "#ff7a85",
  },
  light: {
    canvas: "#f3f4f6", panel: "#ffffff", border: "#dde1e6", text: "#1f2328", muted: "#636b78", grid: "#eef0f3", track: "#eceff2", chip: "#f6f7f9",
    green: "#1e9a57", yellow: "#a87b12", blue: "#2f6fdb", purple: "#8250df", orange: "#c8651b", red: "#cf3c49",
  },
};

const R4: FontKey = "sans-400";
const R5: FontKey = "sans-500";
const R6: FontKey = "sans-600";
const BIG: FontKey = "cond-600";
const MO: FontKey = "code-400";

const CSS =
  `.r{font-family:${STACK.sans};font-weight:400}.m{font-family:${STACK.sans};font-weight:500}.s{font-family:${STACK.sans};font-weight:600}` +
  `.big{font-family:${STACK.cond};font-weight:600;font-feature-settings:'tnum'}.mono{font-family:${STACK.code};font-weight:400}` +
  "@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}.live{animation:pulse 2s ease-in-out infinite}" +
  REDUCED_MOTION(".live");

function T(x: number, y: number, text: string, fill: string, size: number, cls = "r", extra = ""): string {
  return `<text x="${r(x)}" y="${r(y)}" class="${cls}" font-size="${size}" fill="${fill}"${extra}>${esc(text)}</text>`;
}

function canvas(P: Palette, h: number): string {
  return `<rect width="${W}" height="${h}" rx="6" fill="${P.canvas}"/>`;
}

function panel(P: Palette, x: number, y: number, w: number, h: number, title: string, right?: string): string {
  const s = [
    `<rect x="${r(x + 0.5)}" y="${r(y + 0.5)}" width="${r(w - 1)}" height="${r(h - 1)}" rx="4" fill="${P.panel}" stroke="${P.border}"/>`,
    T(x + 12, y + 22, fit(R5, title, 12.5, w * 0.55), P.text, 12.5, "m"),
  ];
  if (right) s.push(T(x + w - 12, y + 22, fit(R4, right, 11.5, w * 0.42), P.muted, 11.5, "r", ' text-anchor="end"'));
  return s.join("");
}

function area(values: number[], x: number, y: number, w: number, h: number, color: string): string {
  if (values.length < 2 || Math.max(...values) === 0) return "";
  const mx = Math.max(...values);
  const pts = values.map((v, i): [number, number] => [x + (i * w) / (values.length - 1), y + h - (v / mx) * h * 0.9]);
  const line = linePath(pts);
  return `<path d="${line} L${r(x + w)} ${r(y + h)} L${r(x)} ${r(y + h)} Z" fill="${color}" fill-opacity=".16"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.4"/><circle class="live" cx="${r(pts.at(-1)![0])}" cy="${r(pts.at(-1)![1])}" r="2.6" fill="${color}"/>`;
}

function empty(P: Palette, x: number, y: number, text: string): string {
  return T(x, y, text, P.muted, 12.5);
}

function doc(title: string, h: number, fonts: FontKey[], body: string, desc?: string): string {
  return svgDoc({ width: W, height: h, title, ...(desc ? { desc } : {}), fonts, css: CSS, body });
}

// ------------------------------------------------------------------ cards

function profile(v: View, P: Palette): string {
  const H = 226;
  const s = [canvas(P, H)];
  for (let i = 0; i < 4; i++) s.push(`<rect x="${14 + (i % 2) * 7}" y="${15 + Math.floor(i / 2) * 7}" width="5" height="5" rx="1" fill="${P.muted}"/>`);
  s.push(`<text x="38" y="25" class="r" font-size="13" fill="${P.muted}">${esc(fit(R4, v.login, 13, 300))} / <tspan class="s" fill="${P.text}">Profile</tspan></text>`);
  let cx = W - 12;
  for (const [label, value] of [["Refresh", "6h"], ["Range", "Last 12 months"]] as const) {
    const w = measure(R5, value, 12) + measure(R4, label, 12) + 26;
    cx -= w;
    s.push(`<rect x="${r(cx + 0.5)}" y="8.5" width="${r(w)}" height="24" rx="4" fill="${P.chip}" stroke="${P.border}"/>`);
    s.push(`<text x="${r(cx + 9)}" y="25" class="r" font-size="12" fill="${P.muted}">${label} <tspan class="m" fill="${P.text}">${value}</tspan></text>`);
    cx -= 8;
  }
  s.push(`<circle class="live" cx="${r(cx - 8)}" cy="20.5" r="3.5" fill="${P.green}"/>`);

  const y = 44;
  const lw = 470;
  s.push(panel(P, 12, y, lw, H - y - 12, "About"));
  s.push(T(26, y + 62, fit(R6, v.name, 26, lw - 40), P.text, 26, "s", ' letter-spacing="-0.4"'));
  if (v.headline) s.push(T(26, y + 88, fit(R4, v.headline, 14, lw - 40), P.text, 14));
  v.tagline.slice(0, 2).forEach((t, i) => s.push(T(26, y + 112 + i * 20, fit(R4, t, 13, lw - 40), P.muted, 13)));

  const tx = 12 + lw + 8;
  const tw = W - 12 - tx;
  s.push(panel(P, tx, y, tw, H - y - 12, "Details", "table"));
  const rows: Array<[string, string, string]> = [];
  if (v.location) rows.push(["Location", v.location, P.text]);
  rows.push(["On GitHub since", formatDate(v.since), P.text]);
  v.programs.slice(0, 2).forEach((p) => rows.push(["Program", p, P.text]));
  if (v.website) rows.push(["Web", v.website, P.blue]);
  rows.push(["Followers", formatInt(v.followers), P.text]);
  rows.slice(0, 5).forEach(([k, val, tone], i) => {
    const ry = y + 34 + i * 26;
    s.push(`<line x1="${tx + 1}" y1="${r(ry + 0.5)}" x2="${tx + tw - 1}" y2="${r(ry + 0.5)}" stroke="${P.grid}"/>`);
    s.push(T(tx + 12, ry + 18, k, P.muted, 12.5));
    s.push(T(tx + tw - 12, ry + 18, fit(R4, val, 12.5, tw - 140), tone, 12.5, "r", ' text-anchor="end"'));
  });
  return doc(`${v.name} on GitHub`, H, [R4, R5, R6], s.join(""), [v.headline, ...v.tagline].filter(Boolean).join(". "));
}

function stats(v: View, P: Palette): string {
  const H = 164;
  const st = v.stats;
  const s = [canvas(P, H)];
  const items: Array<[string, number, string, number[] | null, string]> = [
    ["Merged upstream", st.mergedUpstream, P.green, v.months.map((m) => m.merged), `${formatInt(st.upstreamOwners)} orgs`],
    ["Stars earned", st.stars, P.yellow, null, `${formatInt(st.repos)} repos`],
    ["Contributions", st.contributions, P.blue, v.weeks.map((w) => w.total), "12 mo"],
    ["Active days", st.activeDays, P.purple, v.months.map((m) => m.activeDays), `streak ${formatInt(st.longestStreak)}d`],
  ];
  const pw = (W - 24 - 3 * 8) / 4;
  items.forEach(([title, val, color, series, unit], i) => {
    const x = 12 + i * (pw + 8);
    const y = 12;
    s.push(panel(P, x, y, pw, 140, title, unit));
    if (series) s.push(area(series, x + 1, y + 92, pw - 2, 47, color));
    else {
      const top = v.repos.slice(0, 6);
      const mx = Math.max(1, ...top.map((rp) => rp.stars));
      const bw = (pw - 24) / Math.max(1, top.length);
      top.forEach((rp, k) => {
        const h = Math.max(2, (rp.stars / mx) * 38);
        s.push(`<rect x="${r(x + 12 + k * bw)}" y="${r(y + 130 - h)}" width="${r(bw - 6)}" height="${r(h)}" rx="1" fill="${color}" fill-opacity=".35"/>`);
      });
    }
    s.push(T(x + 12, y + 84, formatInt(val), color, 50, "big"));
  });
  return doc("GitHub stats", H, [R4, R5, BIG], s.join(""), `${st.mergedUpstream} pull requests merged upstream, ${st.stars} stars, ${st.contributions} contributions in the last year.`);
}

function activity(v: View, P: Palette): string {
  const H = 300;
  const s = [canvas(P, H)];
  const weeks = v.weeks;
  s.push(panel(P, 12, 8, W - 24, 162, "Contributions per week", `${formatInt(v.stats.contributions)} in 12 months`));
  const vals = weeks.map((w) => w.total);
  const mx = Math.max(4, ...vals);
  const x0 = 52;
  const x1 = W - 26;
  const y0 = 44;
  const ch = 96;
  for (const g of [0, 0.5, 1]) {
    const gy = y0 + ch - g * ch;
    s.push(`<line x1="${x0}" y1="${r(gy + 0.5)}" x2="${x1}" y2="${r(gy + 0.5)}" stroke="${P.grid}"/>`);
    s.push(T(x0 - 8, gy + 4, String(Math.round(g * mx)), P.muted, 10.5, "mono", ' text-anchor="end"'));
  }
  const pts = vals.map((val, i): [number, number] => [x0 + (i * (x1 - x0)) / Math.max(1, vals.length - 1), y0 + ch - (val / mx) * ch]);
  if (pts.length > 1) {
    const line = linePath(pts);
    s.push(`<path d="${line} L${x1} ${y0 + ch} L${x0} ${y0 + ch} Z" fill="${P.blue}" fill-opacity=".14"/><path d="${line}" fill="none" stroke="${P.blue}" stroke-width="1.5" stroke-linejoin="round"/><circle class="live" cx="${r(pts.at(-1)![0])}" cy="${r(pts.at(-1)![1])}" r="3" fill="${P.blue}"/>`);
  }
  weeks.forEach((w, i) => {
    if (i > 0 && w.start.slice(5, 7) !== weeks[i - 1]!.start.slice(5, 7)) s.push(T(pts[i]![0], y0 + ch + 16, shortMonth(w.start), P.muted, 10.5, "mono", ' text-anchor="middle"'));
  });

  const active = weeks.filter((w) => w.total > 0).length;
  const pct = weeks.length ? (active / weeks.length) * 100 : 0;
  s.push(panel(P, 12, 178, W - 24, H - 178 - 8, "Contribution uptime", `${active} of ${weeks.length} weeks active · ${pct.toFixed(1)}%`));
  const ux0 = 26;
  const ux1 = W - 26;
  const cw = (ux1 - ux0) / Math.max(1, weeks.length);
  weeks.forEach((w, i) => {
    const op = w.total === 0 ? 1 : w.total < 3 ? 0.45 : w.total < 10 ? 0.7 : 1;
    s.push(`<rect x="${r(ux0 + i * cw + 1)}" y="212" width="${r(cw - 2)}" height="34" rx="2" fill="${w.total === 0 ? P.track : P.green}" fill-opacity="${op}"/>`);
  });
  s.push(T(ux0, 266, "52 weeks ago", P.muted, 10.5, "mono"));
  s.push(T(ux1, 266, "this week", P.muted, 10.5, "mono", ' text-anchor="end"'));
  s.push(`<line x1="${ux0 + 92}" y1="262.5" x2="${ux1 - 70}" y2="262.5" stroke="${P.border}"/>`);
  return doc("Contribution activity", H, [R4, R5, MO], s.join(""), `${v.stats.contributions} contributions; active in ${active} of ${weeks.length} weeks.`);
}

function upstream(v: View, P: Palette): string {
  const rows = v.timeline.rows;
  const months = v.timeline.months;
  const table = v.upstream.slice(0, 5);
  const th = rows.length ? 58 + rows.length * 30 + 26 : 76;
  const tb = table.length ? 48 + table.length * 28 + 8 : 0;
  const H = 8 + th + (tb ? 8 + tb : 0) + 8;
  const st = v.stats;
  const s = [canvas(P, H)];
  s.push(panel(P, 12, 8, W - 24, th, "Upstream merges", "state timeline · merged PRs per month"));
  if (!rows.length) {
    s.push(empty(P, 26, 60, v.upstream.length ? "No merges in the last 12 months." : "No merged pull requests to other people’s repositories yet."));
  } else {
    const colors = [P.green, P.blue, P.purple, P.orange, P.yellow, P.red];
    const x0 = 214;
    const x1 = W - 28;
    const cw = (x1 - x0) / 12;
    rows.forEach((row, i) => {
      const y = 44 + i * 30;
      s.push(T(26, y + 16, fit(R4, row.label, 12.5, 176), P.text, 12.5));
      s.push(`<rect x="${x0}" y="${y + 3}" width="${r(x1 - x0)}" height="20" rx="2" fill="${P.track}"/>`);
      row.counts.forEach((n, j) => {
        if (!n) return;
        s.push(`<rect x="${r(x0 + j * cw + 1)}" y="${y + 3}" width="${r(cw - 2)}" height="20" rx="2" fill="${colors[i % colors.length]}" fill-opacity=".92"/>`);
        s.push(T(x0 + j * cw + cw / 2, y + 17.5, String(n), P.panel, 11.5, "s", ' text-anchor="middle"'));
      });
    });
    const ly = 44 + rows.length * 30 + 12;
    months.forEach((m, j) => s.push(T(x0 + j * cw + cw / 2, ly, shortMonth(m), P.muted, 10.5, "mono", ' text-anchor="middle"')));
  }
  if (tb) {
    const ty = 8 + th + 8;
    s.push(panel(P, 12, ty, W - 24, tb, "Top upstream repositories", `${formatInt(st.mergedUpstream)} merged · ${formatInt(st.upstreamOwners)} orgs`));
    const cols: Array<[string, number, string]> = [["Repository", 26, ""], ["Stars", 520, ' text-anchor="end"'], ["Merged", 600, ' text-anchor="end"'], ["Latest merge", W - 26, ' text-anchor="end"']];
    cols.forEach(([label, x, a]) => s.push(T(x, ty + 42, label, P.muted, 11, "m", a)));
    table.forEach((u, i) => {
      const y = ty + 50 + i * 28;
      s.push(`<line x1="13" y1="${r(y + 0.5)}" x2="${W - 13}" y2="${r(y + 0.5)}" stroke="${P.grid}"/>`);
      s.push(T(26, y + 19, fit(R4, u.repo, 12.5, 380), P.blue, 12.5));
      s.push(T(520, y + 19, compactNumber(u.stars), P.text, 15, "big", ' text-anchor="end"'));
      s.push(T(600, y + 19, formatInt(u.merged), P.text, 15, "big", ' text-anchor="end"'));
      s.push(T(W - 26, y + 19, formatDate(u.latest.mergedAt), P.muted, 12.5, "r", ' text-anchor="end"'));
    });
  }
  return doc("Merged pull requests upstream", H, [R4, R5, R6, BIG, MO], s.join(""), `${st.mergedUpstream} pull requests merged into ${st.upstreamRepos} repositories owned by others.`);
}

function languages(v: View, P: Palette): string {
  const langs = v.languages;
  const H = langs.length ? 52 + langs.length * 26 + 20 : 90;
  const s = [canvas(P, H), panel(P, 12, 8, W - 24, H - 16, "Languages", "bar gauge · share of code")];
  if (!langs.length) {
    s.push(empty(P, 26, 58, "No language data yet."));
    return doc("Languages", H, [R4, R5], s.join(""));
  }
  const top = Math.max(...langs.map((l) => l.share));
  const n = 72;
  const seg = 6;
  langs.forEach((l, i) => {
    const y = 42 + i * 26;
    s.push(T(26, y + 12, fit(R4, l.name, 12.5, 130), l.name === "Other" ? P.muted : P.text, 12.5));
    const lit = Math.max(1, Math.round((l.share / top) * n));
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const col = t < 0.6 ? P.green : t < 0.85 ? P.yellow : P.orange;
      s.push(`<rect x="${166 + k * (seg + 2)}" y="${y}" width="${seg}" height="16" rx="1" fill="${k < lit ? col : P.track}"/>`);
    }
    s.push(T(W - 26, y + 13, `${(l.share * 100).toFixed(l.share < 0.1 ? 1 : 0)}%`, P.text, 16, "big", ' text-anchor="end"'));
  });
  return doc("Languages", H, [R4, R5, BIG], s.join(""), langs.map((l) => `${l.name} ${(l.share * 100).toFixed(0)}%`).join(", "));
}

function repos(v: View, P: Palette): string {
  const items = v.repos;
  const H = items.length ? 58 + items.length * 30 + 16 : 90;
  const s = [canvas(P, H), panel(P, 12, 8, W - 24, H - 16, "Top repositories", "table")];
  if (!items.length) {
    s.push(empty(P, 26, 58, "No public repositories yet."));
    return doc("Repositories", H, [R4, R5], s.join(""));
  }
  const cols: Array<[string, number, string]> = [["Name", 26, ""], ["Language", 340, ""], ["Stars", 600, ' text-anchor="end"'], ["Forks", 680, ' text-anchor="end"'], ["Updated", W - 26, ' text-anchor="end"']];
  cols.forEach(([label, x, a]) => s.push(T(x, 50, label, P.muted, 11, "m", a)));
  const mx = Math.max(1, ...items.map((rp) => rp.stars));
  items.forEach((rp, i) => {
    const y = 58 + i * 30;
    s.push(`<line x1="13" y1="${r(y + 0.5)}" x2="${W - 13}" y2="${r(y + 0.5)}" stroke="${P.grid}"/>`);
    s.push(T(26, y + 20, fit(R4, rp.name, 12.5, 290), P.blue, 12.5));
    s.push(T(340, y + 20, fit(R4, rp.language ?? "", 12.5, 120), P.muted, 12.5));
    s.push(`<rect x="470" y="${y + 9}" width="${r(Math.max(2, (rp.stars / mx) * 90))}" height="12" rx="1" fill="${P.yellow}" fill-opacity=".85"/>`);
    s.push(T(600, y + 20, formatInt(rp.stars), P.text, 15, "big", ' text-anchor="end"'));
    s.push(T(680, y + 20, formatInt(rp.forks), P.muted, 15, "big", ' text-anchor="end"'));
    s.push(T(W - 26, y + 20, rp.pushedAt ? formatDate(rp.pushedAt.slice(0, 7)) : "", P.muted, 12.5, "r", ' text-anchor="end"'));
  });
  return doc("Top repositories", H, [R4, R5, BIG], s.join(""), items.map((rp) => `${rp.name}, ${rp.stars} stars`).join("; "));
}

function writing(v: View, P: Palette): string {
  const posts = v.posts;
  const H = posts.length ? 48 + posts.length * 28 + 16 : 90;
  const s = [canvas(P, H), panel(P, 12, 8, W - 24, H - 16, "Logs", posts.length ? `${v.blogHost ?? "blog"} · ${posts.length} lines` : "blog")];
  if (!posts.length) {
    s.push(empty(P, 26, 58, "Add your blog’s RSS feed with the blog input to stream posts here."));
    return doc("Writing", H, [R4, R5], s.join(""));
  }
  posts.forEach((p, i) => {
    const y = 42 + i * 28;
    s.push(`<rect x="13" y="${y}" width="3" height="20" fill="${P.blue}"/>`);
    s.push(T(26, y + 14, p.date ?? "", P.muted, 12, "mono"));
    s.push(`<rect x="118" y="${y + 2}" width="38" height="16" rx="3" fill="${P.blue}" fill-opacity=".16"/>`);
    s.push(T(137, y + 14, "post", P.blue, 11, "mono", ' text-anchor="middle"'));
    s.push(T(168, y + 14, fit(R4, p.title, 13, W - 168 - 26), P.text, 13));
  });
  return doc("Writing", H, [R4, R5, MO], s.join(""), posts.map((p) => p.title).join("; "));
}

const CARDS: Record<CardId, (v: View, P: Palette) => string> = { profile, stats, activity, upstream, languages, repos, writing };

export const ops: Look = {
  id: "ops",
  name: "Ops dashboard",
  description: "Your profile as an observability dashboard: stat panels, a state timeline, bar gauges.",
  render: (card, view, scheme) => CARDS[card](view, PAL[scheme]),
};
