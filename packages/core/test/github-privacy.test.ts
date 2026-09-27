import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectProfile, createGitHubClient, PrivacyError } from "../src/index.ts";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const TOKEN = "ghp_SECRET_TOKEN_VALUE_1234567890";
const now = new Date("2026-09-26T12:00:00Z");

function repoNode(name: string, isPrivate: boolean) {
  return {
    name,
    nameWithOwner: `ada-ops/${name}`,
    description: `${name} description`,
    url: `https://github.com/ada-ops/${name}`,
    isPrivate,
    isFork: false,
    isArchived: false,
    stargazerCount: 5,
    forkCount: 1,
    pushedAt: "2026-09-01T00:00:00Z",
    owner: { login: "ada-ops" },
    primaryLanguage: { name: "Go", color: "#00ADD8" },
    languages: { edges: [{ size: 100, node: { name: "Go", color: "#00ADD8" } }] },
    repositoryTopics: { nodes: [] },
  };
}

function mockFetch(opts: { privateRepo?: boolean; privatePr?: boolean; failFirst?: boolean }) {
  const calls: Call[] = [];
  let failed = false;
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ url, headers, body });
    if (opts.failFirst && !failed) {
      failed = true;
      return new Response("bad gateway", { status: 502 });
    }
    if (url.startsWith("https://avatars.githubusercontent.com/")) {
      return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
    }
    const { query: q, variables } = JSON.parse(body || "{}") as { query: string; variables: Record<string, string> };
    const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
    if (q.includes("avatarUrl")) {
      return json({
        user: {
          login: "ada-ops", name: "Ada", bio: "Platform engineer | Kubernetes", company: null, location: null, websiteUrl: null, twitterUsername: null,
          avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4", url: "https://github.com/ada-ops", createdAt: "2025-01-01T00:00:00Z",
          followers: { totalCount: 3 },
        },
      });
    }
    if (q.includes("repositories(first")) {
      const nodes = [repoNode("public-one", false)];
      if (opts.privateRepo) nodes.push(repoNode("secret-client-repo", true));
      return json({ user: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } });
    }
    if (q.includes("contributionsCollection")) {
      assert.equal(variables["to"], now.toISOString());
      return json({
        user: {
          contributionsCollection: {
            restrictedContributionsCount: 0,
            contributionCalendar: { totalContributions: 4, weeks: [{ contributionDays: [{ date: "2026-09-25", contributionCount: 4 }] }] },
          },
        },
      });
    }
    if (q.includes("search(query")) {
      assert.match(variables["q"]!, /author:ada-ops is:pr is:merged -user:ada-ops/);
      const pr = (n: number, repo: string, isPrivate: boolean) => ({
        title: `Fix ${n}`, url: `https://github.com/${repo}/pull/${n}`, number: n, mergedAt: `2026-09-0${n}T00:00:00Z`,
        repository: { nameWithOwner: repo, url: `https://github.com/${repo}`, stargazerCount: 100, isPrivate, owner: { login: repo.split("/")[0] } },
      });
      const nodes = [pr(2, "org/repo", false), pr(1, "ada-ops/own-repo", false)];
      if (opts.privatePr) nodes.push(pr(3, "client/secret-pr-repo", true));
      return json({ search: { issueCount: nodes.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes } });
    }
    return json({});
  };
  return { fetch, calls };
}

describe("github source", () => {
  it("collects and normalizes profile data", async () => {
    const { fetch } = mockFetch({});
    const data = await collectProfile({ user: "ada-ops", token: TOKEN, mode: "public", fetch, now });
    assert.equal(data.user.login, "ada-ops");
    assert.equal(data.repos.length, 1);
    assert.deepEqual(data.contributions.days, [{ date: "2026-09-25", count: 4 }]);
    assert.equal(data.upstream.items.length, 1, "own repositories are never counted as upstream");
    assert.equal(data.upstream.items[0]!.repo.nameWithOwner, "org/repo");
    assert.ok(data.user.avatarDataUri?.startsWith("data:image/png;base64,"));
  });

  it("never sends the token to non-API hosts", async () => {
    const { fetch, calls } = mockFetch({});
    await collectProfile({ user: "ada-ops", token: TOKEN, mode: "public", fetch, now });
    for (const call of calls) {
      const auth = call.headers["Authorization"] ?? "";
      if (!call.url.startsWith("https://api.github.com/")) assert.equal(auth, "", `token leaked to ${call.url}`);
      else assert.equal(auth, `Bearer ${TOKEN}`);
    }
  });

  it("retries transient failures", async () => {
    const { fetch } = mockFetch({ failFirst: true });
    const client = createGitHubClient({ token: TOKEN, fetch, sleep: async () => {} });
    const data = await collectProfile({ user: "ada-ops", token: TOKEN, mode: "public", now, client });
    assert.equal(data.user.login, "ada-ops");
  });

  it("keeps the token out of error messages", async () => {
    const fetch = async () => new Response("nope", { status: 401 });
    await assert.rejects(
      collectProfile({ user: "ada-ops", token: TOKEN, mode: "public", fetch, now }),
      (err: Error) => !err.message.includes(TOKEN) && /HTTP 401/.test(err.message),
    );
  });
});

describe("privacy boundary", () => {
  for (const [name, opts, key] of [
    ["private repositories", { privateRepo: true }, "repositories"],
    ["private pull requests", { privatePr: true }, "pullRequests"],
  ] as const) {
    it(`refuses a public build when the token can read ${name}, without naming them`, async () => {
      const { fetch } = mockFetch(opts);
      await assert.rejects(collectProfile({ user: "ada-ops", token: TOKEN, mode: "public", fetch, now }), (err: unknown) => {
        assert.ok(err instanceof PrivacyError);
        assert.ok(!/secret/.test(err.message), "private names must not appear in public logs");
        assert.equal(err.counts[key], 1);
        return true;
      });
    });
  }

  it("allows private data in the owner-only private mode", async () => {
    const { fetch } = mockFetch({ privateRepo: true, privatePr: true });
    const data = await collectProfile({ user: "ada-ops", token: TOKEN, mode: "private", fetch, now });
    assert.ok(data.repos.some((r) => r.visibility === "private"));
  });
});
