/** RSS 2.0 / RSS 1.0 / Atom feed parsing. */
import type { PostInfo } from "../model/types.ts";
import { parseLooseDate } from "../util/dates.ts";
import { stripHtml, truncateChars } from "../util/text.ts";
import { child, children, parseXml, textOf, type XmlElement } from "../util/xml.ts";
import type { FetchLike } from "./github/client.ts";

function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function summaryOf(bodies: string[]): string | null {
  for (const body of bodies) {
    const text = stripHtml(body);
    if (text) return truncateChars(text, 220);
  }
  return null;
}

export function parseFeed(xml: string, source: string): PostInfo[] {
  const doc = parseXml(xml);
  const root = doc.children.find((c): c is XmlElement => typeof c !== "string");
  if (!root) return [];
  const posts: PostInfo[] = [];

  if (root.name === "feed") {
    for (const entry of children(root, "entry")) {
      const links = children(entry, "link");
      const alt = links.find((l) => !l.attrs["rel"] || l.attrs["rel"] === "alternate") ?? links[0];
      const url = httpUrl(alt?.attrs["href"]);
      if (!url) continue;
      posts.push({
        title: stripHtml(textOf(child(entry, "title"))) || url,
        url,
        publishedAt: parseLooseDate(textOf(child(entry, "published", "updated"))),
        summary: summaryOf([textOf(child(entry, "summary")), textOf(child(entry, "content"))].filter(Boolean)),
        source,
      });
    }
  } else {
    const channel = child(root, "channel") ?? root;
    for (const item of [...children(channel, "item"), ...children(root, "item")]) {
      const url = httpUrl(textOf(child(item, "link")) || textOf(child(item, "guid")));
      if (!url) continue;
      posts.push({
        title: stripHtml(textOf(child(item, "title"))) || url,
        url,
        publishedAt: parseLooseDate(textOf(child(item, "pubDate", "dc:date", "published"))),
        summary: summaryOf([textOf(child(item, "description")), textOf(child(item, "content:encoded"))].filter(Boolean)),
        source,
      });
    }
  }
  return posts.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

export async function collectPosts(
  feeds: string[],
  opts: { fetch?: FetchLike; limit: number; timeoutMs?: number },
): Promise<{ posts: PostInfo[]; warnings: string[] }> {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const warnings: string[] = [];
  const all: PostInfo[] = [];
  for (const feed of feeds) {
    const source = new URL(feed).hostname;
    try {
      const res = await doFetch(feed, {
        headers: { Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5", "User-Agent": "readmeops" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      });
      if (!res.ok) {
        warnings.push(`feed ${source}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (text.length > 5_000_000) {
        warnings.push(`feed ${source}: larger than 5 MB, skipped`);
        continue;
      }
      all.push(...parseFeed(text, source));
    } catch (err) {
      warnings.push(`feed ${source}: ${(err as Error).message}`);
    }
  }
  const seen = new Set<string>();
  const posts = all
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true)))
    .slice(0, opts.limit);
  return { posts, warnings };
}
