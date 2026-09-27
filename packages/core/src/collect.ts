/** Collects everything the cards need into one ProfileData. */
import type { BuildMode, ProfileData } from "./model/types.ts";
import { emptyProfile } from "./model/types.ts";
import { assertPublicSafe } from "./privacy.ts";
import { createGitHubClient, type FetchLike, type GitHubClient } from "./sources/github/client.ts";
import { fetchAvatarDataUri, fetchContributions, fetchRepos, fetchUpstream, fetchUser } from "./sources/github/collect.ts";
import { collectPosts } from "./sources/rss.ts";

export interface CollectOptions {
  user: string;
  token: string;
  mode: BuildMode;
  /** RSS or Atom feed URLs for the writing card. */
  feeds?: string[];
  programs?: string[];
  headline?: string | null;
  now?: Date;
  fetch?: FetchLike;
  client?: GitHubClient;
  log?: (message: string) => void;
}

export async function collectProfile(opts: CollectOptions): Promise<ProfileData> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const client = opts.client ?? createGitHubClient({ token: opts.token, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const data = emptyProfile(opts.user, opts.mode, now);
  data.programs = opts.programs ?? [];
  data.headline = opts.headline ?? null;

  log(`github: profile of ${opts.user}`);
  data.user = await fetchUser(client, opts.user);
  const login = data.user.login;

  log("github: repositories");
  data.repos = await fetchRepos(client, login);
  log("github: contribution calendar");
  data.contributions = await fetchContributions(client, login, now);
  log("github: merged pull requests to other repositories");
  data.upstream = await fetchUpstream(client, login);

  try {
    data.user.avatarDataUri = await fetchAvatarDataUri(client, data.user.avatarUrl);
  } catch {
    data.warnings.push("avatar could not be downloaded; the profile card shows your initial instead");
  }

  if (opts.feeds && opts.feeds.length > 0) {
    log(`rss: ${opts.feeds.length} feed(s)`);
    const { posts, warnings } = await collectPosts(opts.feeds, { limit: 6, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
    data.posts = posts;
    data.warnings.push(...warnings);
  }

  if (opts.mode === "public") assertPublicSafe(data);
  return data;
}
