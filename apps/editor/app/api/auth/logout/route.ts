import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/** POST only, so a cross-site GET (e.g. an <img>) cannot sign you out. */
export async function POST(req: NextRequest) {
  const cfg = env();
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(cfg.appUrl).origin) return new NextResponse("forbidden", { status: 403 });
  const res = NextResponse.redirect(new URL("/", cfg.appUrl), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
