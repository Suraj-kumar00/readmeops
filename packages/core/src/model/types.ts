/**
 * Normalized profile data as collected from GitHub and feeds. Everything that can
 * be private carries an explicit `visibility`, so the privacy guard can prove what
 * a public build contains.
 */

export type Visibility = "public" | "private";
export type BuildMode = "public" | "private";

export interface LanguageRef {
  name: string;
  color: string | null;
}

export interface UserInfo {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  websiteUrl: string | null;
  twitterUsername: string | null;
  avatarUrl: string;
  /** base64 data URI of the avatar, embedded so the SVG loads nothing external */
  avatarDataUri: string | null;
  url: string;
  createdAt: string;
  followers: number;
}

export interface RepoInfo {
  nameWithOwner: string;
  name: string;
  owner: string;
  description: string | null;
  url: string;
  visibility: Visibility;
  isFork: boolean;
  isArchived: boolean;
  stars: number;
  forks: number;
  primaryLanguage: LanguageRef | null;
  languages: Array<LanguageRef & { bytes: number }>;
  topics: string[];
  pushedAt: string | null;
}

export interface ContributionDay {
  /** YYYY-MM-DD */
  date: string;
  count: number;
}

export interface Contributions {
  /** One entry per day of the last year, oldest first. */
  days: ContributionDay[];
  /** Calendar total as GitHub reports it to this token. */
  total: number;
  /** Contributions the token cannot see in detail (GitHub's "restricted" count). */
  restricted: number;
}

export interface PullRequestInfo {
  title: string;
  url: string;
  number: number;
  mergedAt: string;
  /** Lines added plus lines deleted. */
  changedLines: number;
  repo: {
    nameWithOwner: string;
    owner: string;
    url: string;
    stars: number;
    visibility: Visibility;
  };
}

export interface PostInfo {
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string | null;
  source: string;
}

export interface ProfileData {
  schemaVersion: 2;
  mode: BuildMode;
  generatedAt: string;
  user: UserInfo;
  repos: RepoInfo[];
  contributions: Contributions;
  /** Merged pull requests to repositories the user does not own, newest first. */
  upstream: { total: number; items: PullRequestInfo[] };
  posts: PostInfo[];
  /** Lines the user typed (programs, communities, certifications). */
  programs: string[];
  /** One line the user typed to describe themselves; falls back to the GitHub bio. */
  headline: string | null;
  warnings: string[];
}

export function emptyProfile(login: string, mode: BuildMode, now: Date): ProfileData {
  return {
    schemaVersion: 2,
    mode,
    generatedAt: now.toISOString(),
    user: {
      login,
      name: null,
      bio: null,
      company: null,
      location: null,
      websiteUrl: null,
      twitterUsername: null,
      avatarUrl: `https://github.com/${login}.png`,
      avatarDataUri: null,
      url: `https://github.com/${login}`,
      createdAt: now.toISOString(),
      followers: 0,
    },
    repos: [],
    contributions: { days: [], total: 0, restricted: 0 },
    upstream: { total: 0, items: [] },
    posts: [],
    programs: [],
    headline: null,
    warnings: [],
  };
}
