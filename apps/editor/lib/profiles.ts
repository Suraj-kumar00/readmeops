import "server-only";
import { collectProfile, createGitHubClient, GitHubApiError, PrivacyError, type BuildMode, type ProfileData } from "@readmeops/core";
import { guardedFetch } from "./github";
import { TtlCache } from "./limits";

export interface ProfileResponse {
  data: ProfileData;
  /** Default branch of the profile repository (login/login), or null when it does not exist yet. */
  profileBranch: string | null;
}

const publicCache = new TtlCache<ProfileResponse>(30 * 60_000, 500);

async function profileBranch(token: string, login: string): Promise<string | null> {
  const client = createGitHubClient({ token, fetch: guardedFetch });
  const { data } = await client.graphql<{ repository: { defaultBranchRef: { name: string } | null } | null }>(
    "query($o: String!) { repository(owner: $o, name: $o) { defaultBranchRef { name } } }",
    { o: login },
  );
  return data.repository?.defaultBranchRef?.name ?? null;
}

/** Public data only, as anyone would see it. Cached per login. */
export async function publicProfile(token: string, login: string): Promise<ProfileResponse> {
  const key = login.toLowerCase();
  const hit = publicCache.get(key);
  if (hit) return hit;
  const data = await collectProfile({ user: login, token, mode: "public", fetch: guardedFetch });
  const result = { data, profileBranch: await profileBranch(token, data.user.login).catch(() => null) };
  publicCache.set(key, result);
  return result;
}

/** The signed-in owner's data including private work. Never cached. */
export async function ownerProfile(token: string, login: string): Promise<ProfileResponse> {
  const mode: BuildMode = "private";
  const data = await collectProfile({ user: login, token, mode, fetch: guardedFetch });
  return { data, profileBranch: await profileBranch(token, login).catch(() => null) };
}

export function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof PrivacyError) return { status: 500, message: "The server token can read private data, so public lookups are disabled. Use a token with public access only." };
  if (err instanceof GitHubApiError) {
    if (err.status === 401) return { status: 401, message: "GitHub rejected the token." };
    if (err.status === 403 || err.status === 429) return { status: 429, message: "GitHub rate limit reached. Try again in a few minutes." };
    return { status: 502, message: "GitHub did not respond. Try again." };
  }
  const message = (err as Error).message ?? "";
  if (/was not found/.test(message)) return { status: 404, message: "No GitHub user with that name." };
  return { status: 502, message: "Could not load that profile." };
}
