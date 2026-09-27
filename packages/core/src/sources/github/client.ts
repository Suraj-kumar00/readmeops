/**
 * GitHub API client over the platform fetch. Retries transient failures and
 * secondary rate limits; never includes the token in errors.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GitHubClientOptions {
  token: string;
  fetch?: FetchLike;
  apiUrl?: string;
  userAgent?: string;
  retries?: number;
  timeoutMs?: number;
  /** Injected for tests; defaults to real timers. */
  sleep?: (ms: number) => Promise<void>;
}

export class GitHubApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

export interface GraphQLResult<T> {
  data: T;
  errors: Array<{ message: string; type?: string; path?: Array<string | number> }>;
}

export interface GitHubClient {
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<GraphQLResult<T>>;
  rest<T>(path: string): Promise<T>;
  bytes(url: string, maxBytes: number): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function createGitHubClient(opts: GitHubClientOptions): GitHubClient {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const api = (opts.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": opts.userAgent ?? "readmeops",
  };

  async function request(url: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    for (;;) {
      let res: Response | null = null;
      let networkError: unknown = null;
      try {
        res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        networkError = err;
      }
      const secondaryLimit =
        res !== null && res.status === 403 && (res.headers.get("retry-after") !== null || res.headers.get("x-ratelimit-remaining") === "0");
      const retryable = networkError !== null || (res !== null && (RETRYABLE.has(res.status) || secondaryLimit));
      if (!retryable || attempt >= retries) {
        if (networkError !== null) {
          throw new GitHubApiError(`network error calling GitHub: ${(networkError as Error).message ?? "unknown"}`, 0);
        }
        return res!;
      }
      const retryAfter = Number(res?.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 1000 * 2 ** attempt;
      attempt++;
      await sleep(wait);
    }
  }

  return {
    async graphql<T>(query: string, variables: Record<string, unknown> = {}) {
      const res = await request(`${api}/graphql`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        const hint = res.status === 401 ? " (check the token)" : "";
        throw new GitHubApiError(`GitHub GraphQL request failed with HTTP ${res.status}${hint}`, res.status);
      }
      const json = (await res.json()) as { data?: T; errors?: GraphQLResult<T>["errors"] };
      if (!json.data) {
        const message = json.errors?.map((e) => e.message).join("; ") ?? "no data";
        throw new GitHubApiError(`GitHub GraphQL error: ${message}`, res.status);
      }
      return { data: json.data, errors: json.errors ?? [] };
    },

    async rest<T>(path: string) {
      const res = await request(`${api}${path.startsWith("/") ? path : `/${path}`}`, { method: "GET", headers });
      if (!res.ok) throw new GitHubApiError(`GitHub REST ${path.split("?")[0]} failed with HTTP ${res.status}`, res.status);
      return (await res.json()) as T;
    },

    async bytes(url: string, maxBytes: number) {
      const res = await request(url, { method: "GET", headers: { "User-Agent": headers["User-Agent"]! } });
      if (!res.ok) return null;
      const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) return null;
      return { bytes: buf, contentType };
    },
  };
}
