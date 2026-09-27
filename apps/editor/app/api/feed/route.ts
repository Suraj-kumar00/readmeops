import { NextResponse, type NextRequest } from "next/server";
import { collectPosts, OptionsError, parseFeeds, type PostInfo } from "@readmeops/core";
import { guardedFetch } from "@/lib/github";
import { clientKey, RateLimiter, TtlCache } from "@/lib/limits";

export const dynamic = "force-dynamic";

const limiter = new RateLimiter(30, 10 * 60_000);
const cache = new TtlCache<PostInfo[]>(30 * 60_000, 500);

/** GET /api/feed?url=<https feed>: latest posts, fetched through the SSRF guard. */
export async function GET(req: NextRequest) {
  let url: string;
  try {
    const feeds = parseFeeds(req.nextUrl.searchParams.get("url") ?? "");
    if (feeds.length !== 1) throw new OptionsError("Give one feed URL.");
    url = feeds[0]!;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  const hit = cache.get(url);
  if (hit) return NextResponse.json({ posts: hit });
  if (!limiter.take(clientKey(req.headers))) return NextResponse.json({ error: "Too many lookups. Try again in a few minutes." }, { status: 429 });
  const { posts, warnings } = await collectPosts([url], { limit: 6, fetch: guardedFetch });
  if (posts.length === 0 && warnings.length) return NextResponse.json({ error: "Could not read that feed. Check the URL points to RSS or Atom." }, { status: 422 });
  cache.set(url, posts);
  return NextResponse.json({ posts }, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } });
}
