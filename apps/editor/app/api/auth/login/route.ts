import { NextResponse, type NextRequest } from "next/server";
import { authMode, env } from "@/lib/env";
import { authorizeUrl, fetchViewer, installUrl } from "@/lib/github";
import { OAUTH_COOKIE, SESSION_COOKIE, cookieOptions, pkceChallenge, randomToken, safeNext, seal, type Session } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/login?next=/[&install=1]
 * install=1 sends the user to the GitHub App install page, where they choose which
 * repositories (including private ones) the app may read.
 */
export async function GET(req: NextRequest) {
  const mode = authMode();
  const cfg = env();
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const install = req.nextUrl.searchParams.get("install") === "1";

  if (mode === "none") return NextResponse.redirect(new URL("/?auth=unconfigured", cfg.appUrl));

  if (mode === "dev-token") {
    const viewer = await fetchViewer(cfg.devToken!);
    const session: Session = {
      token: cfg.devToken!,
      login: viewer.login,
      name: viewer.name,
      avatarUrl: viewer.avatarUrl,
      exp: Math.floor(Date.now() / 1000) + 8 * 3600,
      installed: true,
    };
    const res = NextResponse.redirect(new URL(next, cfg.appUrl));
    res.cookies.set(SESSION_COOKIE, await seal(session, "session"), cookieOptions(8 * 3600));
    return res;
  }

  const state = randomToken();
  const useInstall = install && cfg.appSlug !== null;
  const verifier = useInstall ? null : randomToken(48);
  const target = useInstall
    ? installUrl(cfg.appSlug!, state)
    : authorizeUrl({
        clientId: cfg.clientId!,
        redirectUri: `${cfg.appUrl}/api/auth/callback`,
        state,
        challenge: await pkceChallenge(verifier!),
      });
  const res = NextResponse.redirect(target);
  res.cookies.set(
    OAUTH_COOKIE,
    await seal({ state, verifier, next, exp: Math.floor(Date.now() / 1000) + 600 }, "oauth"),
    cookieOptions(600),
  );
  return res;
}
