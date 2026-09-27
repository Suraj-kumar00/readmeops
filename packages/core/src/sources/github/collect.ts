/** Collect profile data from the GitHub GraphQL API and normalize it. */
import type { Contributions, PullRequestInfo, RepoInfo, UserInfo } from "../../model/types.ts";
import { bytesToBase64 } from "../../util/text.ts";
import type { GitHubClient } from "./client.ts";

const USER_QUERY = `query($login: String!) {
  user(login: $login) {
    login name bio company location websiteUrl twitterUsername avatarUrl url createdAt
    followers { totalCount }
  }
}`;

const REPOS_QUERY = `query($login: String!, $after: String) {
  user(login: $login) {
    repositories(first: 50, after: $after, ownerAffiliations: [OWNER], isFork: false, orderBy: {field: STARGAZERS, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name nameWithOwner description url isPrivate isFork isArchived stargazerCount forkCount pushedAt
        owner { login }
        primaryLanguage { name color }
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } }
        repositoryTopics(first: 10) { nodes { topic { name } } }
      }
    }
  }
}`;

const CONTRIB_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      restrictedContributionsCount
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

const UPSTREAM_QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        title url number mergedAt additions deletions
        repository { nameWithOwner url stargazerCount isPrivate owner { login } }
      }
    }
  }
}`;

interface RawRepo {
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  stargazerCount: number;
  forkCount: number;
  pushedAt: string | null;
  owner: { login: string };
  primaryLanguage: { name: string; color: string | null } | null;
  languages: { edges: Array<{ size: number; node: { name: string; color: string | null } }> };
  repositoryTopics: { nodes: Array<{ topic: { name: string } }> };
}

interface RawPr {
  title?: string;
  url?: string;
  number?: number;
  mergedAt?: string | null;
  additions?: number;
  deletions?: number;
  repository?: { nameWithOwner: string; url: string; stargazerCount: number; isPrivate: boolean; owner: { login: string } };
}

export async function fetchUser(client: GitHubClient, login: string): Promise<UserInfo> {
  type RawUser = Omit<UserInfo, "followers" | "avatarDataUri"> & { followers: { totalCount: number } };
  const { data } = await client.graphql<{ user: RawUser | null }>(USER_QUERY, { login });
  const u = data.user;
  if (!u) throw new Error(`GitHub user "${login}" was not found`);
  return {
    login: u.login,
    name: u.name,
    bio: u.bio,
    company: u.company,
    location: u.location,
    websiteUrl: u.websiteUrl,
    twitterUsername: u.twitterUsername,
    avatarUrl: u.avatarUrl,
    avatarDataUri: null,
    url: u.url,
    createdAt: u.createdAt,
    followers: u.followers.totalCount,
  };
}

export async function fetchRepos(client: GitHubClient, login: string, max = 100): Promise<RepoInfo[]> {
  const repos: RepoInfo[] = [];
  let after: string | null = null;
  while (repos.length < max) {
    const result: { data: { user: { repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawRepo[] } } | null } } =
      await client.graphql(REPOS_QUERY, { login, after });
    const conn = result.data.user?.repositories;
    if (!conn) break;
    for (const r of conn.nodes) {
      if (!r) continue;
      repos.push({
        nameWithOwner: r.nameWithOwner,
        name: r.name,
        owner: r.owner.login,
        description: r.description,
        url: r.url,
        visibility: r.isPrivate ? "private" : "public",
        isFork: r.isFork,
        isArchived: r.isArchived,
        stars: r.stargazerCount,
        forks: r.forkCount,
        primaryLanguage: r.primaryLanguage,
        languages: r.languages.edges.map((e) => ({ name: e.node.name, color: e.node.color, bytes: e.size })),
        topics: r.repositoryTopics.nodes.map((t) => t.topic.name),
        pushedAt: r.pushedAt,
      });
    }
    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return repos.slice(0, max);
}

/** The contribution calendar for the 365 days ending at `now`. */
export async function fetchContributions(client: GitHubClient, login: string, now: Date): Promise<Contributions> {
  const from = new Date(now.getTime() - 364 * 86_400_000);
  from.setUTCHours(0, 0, 0, 0);
  type Raw = {
    restrictedContributionsCount: number;
    contributionCalendar: { totalContributions: number; weeks: Array<{ contributionDays: Array<{ date: string; contributionCount: number }> }> };
  };
  const { data } = await client.graphql<{ user: { contributionsCollection: Raw } | null }>(CONTRIB_QUERY, {
    login,
    from: from.toISOString(),
    to: now.toISOString(),
  });
  const c = data.user?.contributionsCollection;
  if (!c) return { days: [], total: 0, restricted: 0 };
  const days = c.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ date: d.date, count: d.contributionCount }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { days, total: c.contributionCalendar.totalContributions, restricted: c.restrictedContributionsCount };
}

/** Merged pull requests to repositories the user does not own. */
export async function fetchUpstream(client: GitHubClient, login: string, max = 100): Promise<{ total: number; items: PullRequestInfo[] }> {
  const q = `author:${login} is:pr is:merged -user:${login} sort:created-desc`;
  const items: PullRequestInfo[] = [];
  let total = 0;
  let after: string | null = null;
  while (items.length < max) {
    const result: { data: { search: { issueCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawPr[] } } } =
      await client.graphql(UPSTREAM_QUERY, { q, after });
    total = result.data.search.issueCount;
    for (const raw of result.data.search.nodes) {
      if (!raw.url || !raw.repository || raw.number === undefined || !raw.mergedAt) continue;
      if (raw.repository.owner.login.toLowerCase() === login.toLowerCase()) continue;
      items.push({
        title: raw.title ?? "",
        url: raw.url,
        number: raw.number,
        mergedAt: raw.mergedAt,
        changedLines: (raw.additions ?? 0) + (raw.deletions ?? 0),
        repo: {
          nameWithOwner: raw.repository.nameWithOwner,
          owner: raw.repository.owner.login,
          url: raw.repository.url,
          stars: raw.repository.stargazerCount,
          visibility: raw.repository.isPrivate ? "private" : "public",
        },
      });
    }
    const info = result.data.search.pageInfo;
    if (!info.hasNextPage || !info.endCursor) break;
    after = info.endCursor;
  }
  items.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  return { total: Math.max(total, items.length), items: items.slice(0, max) };
}

export async function fetchAvatarDataUri(client: GitHubClient, avatarUrl: string): Promise<string | null> {
  const url = new URL(avatarUrl);
  if (url.hostname !== "avatars.githubusercontent.com") return null;
  url.searchParams.set("s", "160");
  const res = await client.bytes(url.toString(), 500_000);
  if (!res || !/^image\/(png|jpeg|gif|webp)$/.test(res.contentType)) return null;
  return `data:${res.contentType};base64,${bytesToBase64(res.bytes)}`;
}
