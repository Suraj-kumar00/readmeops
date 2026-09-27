import "server-only";

export interface EditorEnv {
  /** Token the server uses to read public profiles (a fine-grained token with no extra access). */
  githubToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
  appSlug: string | null;
  appUrl: string;
  sessionSecret: string | null;
  /** Local development only: a token used instead of the OAuth flow. */
  devToken: string | null;
}

export function env(): EditorEnv {
  const e = process.env;
  const secret = e["SESSION_SECRET"] ?? null;
  return {
    githubToken: e["GITHUB_TOKEN"] || null,
    clientId: e["GITHUB_APP_CLIENT_ID"] || null,
    clientSecret: e["GITHUB_APP_CLIENT_SECRET"] || null,
    appSlug: e["GITHUB_APP_SLUG"] || null,
    appUrl: (e["APP_URL"] || "http://localhost:3000").replace(/\/+$/, ""),
    sessionSecret: secret && secret.length >= 32 ? secret : null,
    devToken: e["NODE_ENV"] === "development" ? e["READMEOPS_DEV_TOKEN"] || null : null,
  };
}

export type AuthMode = "github-app" | "dev-token" | "none";

export function authMode(): AuthMode {
  const cfg = env();
  if (!cfg.sessionSecret) return cfg.devToken ? "dev-token" : "none";
  if (cfg.clientId && cfg.clientSecret) return "github-app";
  return cfg.devToken ? "dev-token" : "none";
}
