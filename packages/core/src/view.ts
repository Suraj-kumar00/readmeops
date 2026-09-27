/**
 * The view model: every number a card shows, computed once from ProfileData so all
 * looks show the same facts. Pure and deterministic; safe to send to a browser.
 */
import type { BuildMode, ContributionDay, ProfileData } from "./model/types.ts";
import { addDays, dateKey, lastMonths, weekday } from "./util/dates.ts";

export const CARD_IDS = ["profile", "stats", "activity", "upstream", "languages", "repos", "writing"] as const;
export type CardId = (typeof CARD_IDS)[number];

export interface WeekPoint {
  start: string;
  total: number;
}
export interface MonthPoint {
  key: string;
  total: number;
  merged: number;
  activeDays: number;
}
export interface LanguageShare {
  name: string;
  color: string | null;
  share: number;
}
export interface UpstreamRepo {
  repo: string;
  owner: string;
  url: string;
  stars: number;
  merged: number;
  changedLines: number;
  latest: { title: string; url: string; mergedAt: string };
}
export interface TimelineRow {
  label: string;
  url: string;
  counts: number[];
}
export interface RepoCard {
  name: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  languageColor: string | null;
  archived: boolean;
  pushedAt: string | null;
}
export interface PostCard {
  title: string;
  url: string;
  date: string | null;
}

export interface View {
  mode: BuildMode;
  generatedAt: string;
  today: string;
  login: string;
  name: string;
  initial: string;
  headline: string | null;
  tagline: string[];
  location: string | null;
  website: string | null;
  websiteUrl: string | null;
  avatar: string | null;
  since: string;
  followers: number;
  programs: string[];
  focus: string[];
  stats: {
    mergedUpstream: number;
    upstreamRepos: number;
    upstreamOwners: number;
    stars: number;
    forks: number;
    repos: number;
    contributions: number;
    activeDays: number;
    longestStreak: number;
    currentStreak: number;
    followers: number;
  };
  weeks: WeekPoint[];
  months: MonthPoint[];
  busiestWeek: WeekPoint | null;
  bestDay: ContributionDay | null;
  languages: LanguageShare[];
  upstream: UpstreamRepo[];
  timeline: { months: string[]; rows: TimelineRow[] };
  repos: RepoCard[];
  posts: PostCard[];
  blogHost: string | null;
}

const TOPIC_STOPLIST = new Set([
  "hacktoberfest", "open-source", "opensource", "good-first-issue", "awesome", "project", "projects",
  "learning", "beginner", "beginners", "portfolio", "readme", "profile", "github", "hacktoberfest2024", "hacktoberfest2025",
]);

function splitBio(bio: string | null): string[] {
  if (!bio) return [];
  return bio
    .split(/\s*[|·•\n]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 60);
}

function displayUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return (u.host + u.pathname).replace(/^www\./, "").replace(/\/$/, "");
  } catch {
    return null;
  }
}

function streaks(days: ContributionDay[], today: string): { longest: number; current: number } {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  let cursor = (byDate.get(today) ?? 0) > 0 ? today : addDays(today, -1);
  let current = 0;
  while ((byDate.get(cursor) ?? 0) > 0) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { longest, current };
}

/** 365 days ending today, missing days filled with zero. */
function lastYear(days: ContributionDay[], today: string): ContributionDay[] {
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const out: ContributionDay[] = [];
  for (let i = 364; i >= 0; i--) {
    const date = addDays(today, -i);
    out.push({ date, count: byDate.get(date) ?? 0 });
  }
  return out;
}

export function buildView(data: ProfileData): View {
  const now = new Date(data.generatedAt);
  const today = dateKey(now);
  const login = data.user.login;
  const own = data.repos.filter((r) => r.owner.toLowerCase() === login.toLowerCase() && !r.isFork);
  const showcase = own.filter((r) => r.name.toLowerCase() !== login.toLowerCase());

  // identity
  const name = (data.user.name ?? "").trim() || login;
  const bioParts = splitBio(data.user.bio);
  const company = data.user.company?.replace(/^@/, "").trim() || null;
  const headline = data.headline?.trim() || bioParts[0] || company || null;
  const programsLower = new Set(data.programs.map((p) => p.toLowerCase()));
  const headlineLower = (headline ?? "").toLowerCase();
  const tagline = bioParts
    .slice(data.headline?.trim() ? 0 : 1)
    .filter((p) => !programsLower.has(p.toLowerCase()) && !headlineLower.includes(p.toLowerCase()))
    .slice(0, 3);

  const topics = new Map<string, number>();
  for (const r of showcase) for (const t of r.topics) if (!TOPIC_STOPLIST.has(t)) topics.set(t, (topics.get(t) ?? 0) + 1);
  const focus = [...topics.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([t]) => t);

  // contributions
  const days = lastYear(data.contributions.days, today);
  const total = days.reduce((s, d) => s + d.count, 0);
  const activeDays = days.filter((d) => d.count > 0).length;
  const { longest, current } = streaks(days, today);
  const weekMap = new Map<string, number>();
  for (const d of days) {
    const start = addDays(d.date, -weekday(d.date));
    weekMap.set(start, (weekMap.get(start) ?? 0) + d.count);
  }
  const weeks = [...weekMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([start, t]) => ({ start, total: t }));
  const busiestWeek = weeks.reduce<WeekPoint | null>((best, w) => (w.total > 0 && (!best || w.total > best.total) ? w : best), null);
  const bestDay = days.reduce<ContributionDay | null>((best, d) => (d.count > 0 && (!best || d.count > best.count) ? d : best), null);

  // months
  const monthKeys = lastMonths(now, 12);
  const months: MonthPoint[] = monthKeys.map((key) => ({ key, total: 0, merged: 0, activeDays: 0 }));
  const monthIndex = new Map(monthKeys.map((k, i) => [k, i]));
  for (const d of days) {
    const i = monthIndex.get(d.date.slice(0, 7));
    if (i === undefined) continue;
    months[i]!.total += d.count;
    if (d.count > 0) months[i]!.activeDays++;
  }

  // upstream
  const items = data.upstream.items;
  const byRepo = new Map<string, UpstreamRepo>();
  for (const pr of items) {
    const key = pr.repo.nameWithOwner.toLowerCase();
    const i = monthIndex.get(pr.mergedAt.slice(0, 7));
    if (i !== undefined) months[i]!.merged++;
    const cur = byRepo.get(key);
    if (cur) {
      cur.merged++;
      cur.changedLines += pr.changedLines;
      if (pr.mergedAt > cur.latest.mergedAt) cur.latest = { title: pr.title, url: pr.url, mergedAt: pr.mergedAt };
    } else {
      byRepo.set(key, {
        repo: pr.repo.nameWithOwner,
        owner: pr.repo.owner,
        url: pr.repo.url,
        stars: pr.repo.stars,
        merged: 1,
        changedLines: pr.changedLines,
        latest: { title: pr.title, url: pr.url, mergedAt: pr.mergedAt },
      });
    }
  }
  // A one-line fix to a famous repo should not outrank real work in a smaller one:
  // rank by project size and by how much was changed, both on a log scale.
  const weight = (u: UpstreamRepo) => Math.log10(u.stars + 10) * Math.log10(10 + u.changedLines);
  const upstream = [...byRepo.values()].sort(
    (a, b) => weight(b) - weight(a) || b.stars - a.stars || b.latest.mergedAt.localeCompare(a.latest.mergedAt),
  );
  const owners = new Set(items.map((p) => p.repo.owner.toLowerCase()));

  // timeline: last 12 months, one row per organization (or repo when an owner has just one)
  const rows = new Map<string, { label: string; url: string; counts: number[]; last: string; repos: Set<string> }>();
  for (const pr of items) {
    const i = monthIndex.get(pr.mergedAt.slice(0, 7));
    if (i === undefined) continue;
    const key = pr.repo.owner.toLowerCase();
    let row = rows.get(key);
    if (!row) {
      row = { label: pr.repo.owner, url: `https://github.com/${pr.repo.owner}`, counts: new Array(12).fill(0), last: pr.mergedAt, repos: new Set() };
      rows.set(key, row);
    }
    row.counts[i]!++;
    row.repos.add(pr.repo.nameWithOwner);
    if (pr.mergedAt > row.last) row.last = pr.mergedAt;
  }
  const timelineRows = [...rows.values()]
    .sort((a, b) => b.last.localeCompare(a.last))
    .slice(0, 6)
    .map((row) => {
      const only = row.repos.size === 1 ? [...row.repos][0]! : null;
      return { label: only ?? row.label, url: only ? `https://github.com/${only}` : row.url, counts: row.counts };
    });

  // languages by bytes
  const bytes = new Map<string, { color: string | null; value: number }>();
  for (const r of own) {
    for (const l of r.languages) {
      const cur = bytes.get(l.name) ?? { color: l.color, value: 0 };
      cur.value += l.bytes;
      bytes.set(l.name, cur);
    }
  }
  const totalBytes = [...bytes.values()].reduce((s, v) => s + v.value, 0);
  const sorted = [...bytes.entries()].sort((a, b) => b[1].value - a[1].value || a[0].localeCompare(b[0]));
  const languages: LanguageShare[] = sorted.slice(0, 6).map(([n, v]) => ({ name: n, color: v.color, share: totalBytes ? v.value / totalBytes : 0 }));
  const rest = sorted.slice(6).reduce((s, [, v]) => s + v.value, 0);
  if (rest > 0 && totalBytes) languages.push({ name: "Other", color: null, share: rest / totalBytes });

  const repos: RepoCard[] = [...showcase]
    .sort((a, b) => b.stars - a.stars || b.forks - a.forks || (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""))
    .slice(0, 6)
    .map((r) => ({
      name: r.name,
      url: r.url,
      description: r.description,
      stars: r.stars,
      forks: r.forks,
      language: r.primaryLanguage?.name ?? null,
      languageColor: r.primaryLanguage?.color ?? null,
      archived: r.isArchived,
      pushedAt: r.pushedAt,
    }));

  const posts = data.posts.slice(0, 5).map((p) => ({ title: p.title, url: p.url, date: p.publishedAt ? p.publishedAt.slice(0, 10) : null }));

  return {
    mode: data.mode,
    generatedAt: data.generatedAt,
    today,
    login,
    name,
    initial: [...name][0]!.toUpperCase(),
    headline,
    tagline,
    location: data.user.location?.trim() || null,
    website: displayUrl(data.user.websiteUrl),
    websiteUrl: data.user.websiteUrl ? (/^https?:\/\//i.test(data.user.websiteUrl) ? data.user.websiteUrl : `https://${data.user.websiteUrl}`) : null,
    avatar: data.user.avatarDataUri,
    since: data.user.createdAt.slice(0, 7),
    followers: data.user.followers,
    programs: data.programs,
    focus,
    stats: {
      mergedUpstream: data.upstream.total,
      upstreamRepos: byRepo.size,
      upstreamOwners: owners.size,
      stars: own.reduce((s, r) => s + r.stars, 0),
      forks: own.reduce((s, r) => s + r.forks, 0),
      repos: own.length,
      contributions: total,
      activeDays,
      longestStreak: longest,
      currentStreak: current,
      followers: data.user.followers,
    },
    weeks,
    months,
    busiestWeek,
    bestDay,
    languages,
    upstream,
    timeline: { months: monthKeys, rows: timelineRows },
    repos,
    posts,
    blogHost: data.posts[0]?.source ?? null,
  };
}
