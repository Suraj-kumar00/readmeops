import "server-only";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * Sessions live only in an encrypted, HttpOnly cookie (AES-256-GCM, key derived
 * with HKDF from SESSION_SECRET). There is no database: nothing to breach later.
 */

export const SESSION_COOKIE = "ro_session";
export const OAUTH_COOKIE = "ro_oauth";

export interface Session {
  token: string;
  login: string;
  name: string | null;
  avatarUrl: string;
  /** Unix seconds. */
  exp: number;
  /** True when the GitHub App is installed, i.e. private repos may be readable. */
  installed: boolean;
}

export interface OAuthState {
  state: string;
  verifier: string | null;
  next: string;
  exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(value, "base64url");
  const out = new Uint8Array(new ArrayBuffer(buf.length));
  out.set(buf);
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function deriveKey(secret: string, purpose: string): Promise<CryptoKey> {
  const id = `${purpose}:${secret}`;
  let key = keyCache.get(id);
  if (!key) {
    key = (async () => {
      const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: enc.encode("readmeops-v1"), info: enc.encode(purpose) },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
    keyCache.set(id, key);
  }
  return key;
}

function secretOrDev(): string {
  const cfg = env();
  if (cfg.sessionSecret) return cfg.sessionSecret;
  if (cfg.devToken) {
    // Development only: an ephemeral key per server process.
    const g = globalThis as { __roDevSecret?: string };
    g.__roDevSecret ??= b64url(crypto.getRandomValues(new Uint8Array(32)));
    return g.__roDevSecret;
  }
  throw new Error("SESSION_SECRET (32+ characters) is not configured");
}

export async function seal(value: unknown, purpose: string): Promise<string> {
  const key = await deriveKey(secretOrDev(), purpose);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value))));
  return `${b64url(iv)}.${b64url(data)}`;
}

export async function unseal<T>(sealed: string | undefined, purpose: string): Promise<T | null> {
  if (!sealed) return null;
  const [ivPart, dataPart] = sealed.split(".");
  if (!ivPart || !dataPart) return null;
  try {
    const key = await deriveKey(secretOrDev(), purpose);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(ivPart) }, key, fromB64url(dataPart));
    return JSON.parse(dec.decode(plain)) as T;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const session = await unseal<Session>(store.get(SESSION_COOKIE)?.value, "session");
  if (!session || session.exp * 1000 < Date.now()) return null;
  return session;
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
  return b64url(digest);
}

/** Only allow same-site relative redirects. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}
