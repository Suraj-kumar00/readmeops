/**
 * Everything a profile repository receives: the card files, the README snippet
 * that shows them, and the workflow that keeps them fresh. The Action and the
 * editor both use these, so they always agree.
 */
import { LOOKS } from "./looks/index.ts";
import { SCHEMES, type LookId } from "./looks/types.ts";
import type { Options } from "./options.ts";
import type { CardId, View } from "./view.ts";

/** Branch in the profile repository that holds the rendered cards. */
export const OUTPUT_BRANCH = "readmeops";
export const ACTION_REF = "Suraj-kumar00/readmeops@v0";
export const WORKFLOW_PATH = ".github/workflows/readmeops.yml";

export interface CardFile {
  path: string;
  svg: string;
}

export function cardFileName(card: CardId, scheme: "dark" | "light"): string {
  return `${card}-${scheme}.svg`;
}

export function renderCards(view: View, look: LookId, cards: readonly CardId[]): CardFile[] {
  const renderer = LOOKS[look];
  return cards.flatMap((card) => SCHEMES.map((scheme) => ({ path: cardFileName(card, scheme), svg: renderer.render(card, view, scheme) })));
}

const ALT: Record<CardId, string> = {
  profile: "Profile",
  stats: "GitHub stats",
  activity: "Contribution activity",
  upstream: "Pull requests merged into other projects",
  languages: "Languages",
  repos: "Top repositories",
  writing: "Latest writing",
};

/** Where each card links, so a reader can check the claim behind it. */
export function cardLink(card: CardId, login: string, blogUrl: string | null = null): string {
  const profile = `https://github.com/${login}`;
  switch (card) {
    case "upstream":
      return `https://github.com/search?q=${encodeURIComponent(`author:${login} is:pr is:merged -user:${login}`).replace(/%20/g, "+")}&type=pullrequests`;
    case "repos":
      return `${profile}?tab=repositories&sort=stargazers`;
    case "stats":
    case "languages":
      return `${profile}?tab=repositories`;
    case "writing":
      return blogUrl ?? profile;
    default:
      return profile;
  }
}

/** `repository` is "owner/name"; a profile README lives in "login/login". */
export function rawUrl(repository: string, file: string): string {
  return `https://raw.githubusercontent.com/${repository}/${OUTPUT_BRANCH}/${file}`;
}

export function readmeSnippet(login: string, cards: readonly CardId[], blogUrl: string | null = null, repository = `${login}/${login}`): string {
  return cards
    .map(
      (card) =>
        `<a href="${cardLink(card, login, blogUrl)}"><picture>\n` +
        `  <source media="(prefers-color-scheme: dark)" srcset="${rawUrl(repository, cardFileName(card, "dark"))}">\n` +
        `  <img alt="${ALT[card]}" src="${rawUrl(repository, cardFileName(card, "light"))}" width="100%">\n` +
        `</picture></a>`,
    )
    .join("\n\n");
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Minute of the hour derived from the login, so refreshes are spread out. */
function minuteFor(login: string): number {
  let h = 0;
  for (const ch of login.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return h % 60;
}

export function workflowYaml(login: string, options: Options): string {
  const withLines = [`          look: ${options.look}`, `          cards: ${options.cards.join(", ")}`];
  if (options.headline) withLines.push(`          headline: ${yamlString(options.headline)}`);
  if (options.feeds.length) withLines.push(`          blog: ${options.feeds.join(" ")}`);
  if (options.programs.length) withLines.push("          programs: |", ...options.programs.map((p) => `            ${p}`));
  return [
    "name: readmeops",
    "on:",
    "  schedule:",
    `    - cron: "${minuteFor(login)} */6 * * *"   # every 6 hours`,
    "  workflow_dispatch:",
    "permissions:",
    "  contents: write",
    "concurrency:",
    "  group: readmeops",
    "  cancel-in-progress: true",
    "jobs:",
    "  cards:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 10",
    "    steps:",
    `      - uses: ${ACTION_REF}`,
    "        with:",
    ...withLines,
    "",
  ].join("\n");
}

/** GitHub's new-file page, prefilled with the workflow (filename and value parameters). */
export function newWorkflowUrl(login: string, branch: string, yaml: string): string {
  return `https://github.com/${login}/${login}/new/${encodeURIComponent(branch)}?filename=${encodeURIComponent(WORKFLOW_PATH)}&value=${encodeURIComponent(yaml)}`;
}
