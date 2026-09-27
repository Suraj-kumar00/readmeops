import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { authMode, env } from "@/lib/env";
import { exchangeCode, fetchViewer } from "@/lib/github";
import { OAUTH_COOKIE, SESSION_COOKIE, cookieOptions, seal, unseal, type OAuthState, type Session } from "@/lib/session";

export const dynamic = "force-dynamic";

function sameState(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function appInstalled(token: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.github.com/user/installations?per_page=1", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "readmeops-editor" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { total_count?: number };
    return (json.total_count ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const cfg = env();
  const fail = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/?auth=${encodeURIComponent(reason)}`, cfg.appUrl));
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  };
  if (authMode() !== "github-app") return fail("unconfigured");

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const saved = await unseal<OAuthState>(req.cookies.get(OAUTH_COOKIE)?.value, "oauth");
  if (!code || !state || !saved || saved.exp * 1000 < Date.now() || !sameState(state, saved.state)) {
    return fail("state");
  }

  try {
    const token = await exchangeCode({
      clientId: cfg.clientId!,
      clientSecret: cfg.clientSecret!,
      code,
      redirectUri: `${cfg.appUrl}/api/auth/callback`,
      verifier: saved.verifier,
    });
    const viewer = await fetchViewer(token.access_token);
    const ttl = Math.min(token.expires_in ?? 8 * 3600, 8 * 3600);
    const session: Session = {
      token: token.access_token,
      login: viewer.login,
      name: viewer.name,
      avatarUrl: viewer.avatarUrl,
      exp: Math.floor(Date.now() / 1000) + ttl,
      installed: await appInstalled(token.access_token),
    };
    const res = NextResponse.redirect(new URL(saved.next, cfg.appUrl));
    res.cookies.set(SESSION_COOKIE, await seal(session, "session"), cookieOptions(ttl));
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  } catch {
    return fail("exchange");
  }
}
