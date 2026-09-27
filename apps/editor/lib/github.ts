import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
}

export function authorizeUrl(opts: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

export function installUrl(slug: string, state: string): string {
  const url = new URL(`https://github.com/apps/${encodeURIComponent(slug)}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  verifier: string | null;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });
  if (opts.verifier) body.set("code_verifier", opts.verifier);
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`GitHub sign-in failed: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`);
  }
  return json as TokenResponse;
}

export async function fetchViewer(token: string): Promise<{ login: string; name: string | null; avatarUrl: string }> {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "readmeops-editor" },
    body: JSON.stringify({ query: "{ viewer { login name avatarUrl } }" }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { data?: { viewer?: { login: string; name: string | null; avatarUrl: string } } };
  const viewer = json.data?.viewer;
  if (!res.ok || !viewer) throw new Error(`could not read your GitHub profile (HTTP ${res.status})`);
  return viewer;
}

// --------------------------------------------------------- SSRF-safe fetch

const GITHUB_HOSTS = new Set(["api.github.com", "avatars.githubusercontent.com"]);
const MAX_BYTES = 3_000_000;

function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("::ffff:")
  );
}

/**
 * fetch for user-supplied URLs (RSS feeds, covers) on a hosted server:
 * https only, default port, public IPs only, no redirects, size and time capped.
 */
export async function guardedFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input);
  if (GITHUB_HOSTS.has(url.hostname)) return fetch(url, init);
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new Error("only https URLs on the default port are allowed");
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some((a) => privateIp(a.address))) {
    throw new Error("destination resolves to a private address");
  }
  const res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  if (res.status >= 300 && res.status < 400) throw new Error("redirects are not followed");
  const length = Number(res.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) throw new Error("response too large");
  if (!res.body) return res;
  // Content-Length can be missing or wrong, so also count the bytes as they arrive.
  let seen = 0;
  const capped = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > MAX_BYTES) controller.error(new Error("response too large"));
        else controller.enqueue(chunk);
      },
    }),
  );
  return new Response(capped, { status: res.status, statusText: res.statusText, headers: res.headers });
}
