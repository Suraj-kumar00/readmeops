import { NextResponse, type NextRequest } from "next/server";
import { isLogin } from "@readmeops/core";
import { env } from "@/lib/env";
import { clientKey, RateLimiter } from "@/lib/limits";
import { describeError, publicProfile } from "@/lib/profiles";

export const dynamic = "force-dynamic";

const limiter = new RateLimiter(30, 10 * 60_000);

/** GET /api/profile?user=<login>: public data only, cached at the edge for 30 minutes. */
export async function GET(req: NextRequest) {
  const user = (req.nextUrl.searchParams.get("user") ?? "").trim();
  if (!isLogin(user)) return NextResponse.json({ error: "That is not a valid GitHub username." }, { status: 400 });
  const token = env().githubToken;
  if (!token) return NextResponse.json({ error: "Live profiles are off: the server has no GITHUB_TOKEN." }, { status: 503 });
  if (!limiter.take(clientKey(req.headers))) return NextResponse.json({ error: "Too many lookups. Try again in a few minutes." }, { status: 429 });
  try {
    const result = await publicProfile(token, user);
    return NextResponse.json(result, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } });
  } catch (err) {
    const { status, message } = describeError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
