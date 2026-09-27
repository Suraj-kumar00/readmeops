import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { describeError, ownerProfile } from "@/lib/profiles";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, private" };

/**
 * GET /api/me: the signed-in owner's own data, private work included. The token
 * never leaves the server and the response is never cached.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "cross-site request refused" }, { status: 403, headers: NO_STORE });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to see your private work." }, { status: 401, headers: NO_STORE });
  try {
    return NextResponse.json({ ...(await ownerProfile(session.token, session.login)), installed: session.installed }, { headers: NO_STORE });
  } catch (err) {
    const { status, message } = describeError(err);
    return NextResponse.json({ error: status === 401 ? "Your session expired. Sign in again." : message }, { status, headers: NO_STORE });
  }
}
