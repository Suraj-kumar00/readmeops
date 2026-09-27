/**
 * The privacy boundary. A public build must never contain private data, so it
 * fails closed: if the token could read anything private, the build stops.
 * Error messages carry counts only, because Action logs of public repos are public.
 */
import type { ProfileData } from "./model/types.ts";

export class PrivacyError extends Error {
  readonly counts: Record<string, number>;

  constructor(counts: Record<string, number>) {
    const summary = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}: ${n}`)
      .join(", ");
    super(
      `Public build refused: the token can read private data (${summary}). ` +
        "Keep the default GITHUB_TOKEN for your profile README; private work belongs in the owner-only view of the editor.",
    );
    this.name = "PrivacyError";
    this.counts = counts;
  }
}

export function countPrivate(data: ProfileData): Record<string, number> {
  return {
    repositories: data.repos.filter((r) => r.visibility === "private").length,
    pullRequests: data.upstream.items.filter((p) => p.repo.visibility === "private").length,
  };
}

export function assertPublicSafe(data: ProfileData): void {
  const counts = countPrivate(data);
  if (Object.values(counts).some((n) => n > 0)) throw new PrivacyError(counts);
}

