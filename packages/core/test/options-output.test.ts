import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildView,
  cardLink,
  DEFAULT_CARDS,
  demoProfile,
  isLogin,
  newWorkflowUrl,
  OptionsError,
  parseOptions,
  readmeSnippet,
  renderCards,
  workflowYaml,
} from "../src/index.ts";

describe("options", () => {
  it("works with no settings at all", () => {
    assert.deepEqual(parseOptions({}), { look: "clean", cards: DEFAULT_CARDS, headline: null, programs: [], feeds: [] });
  });

  it("parses every input", () => {
    const o = parseOptions({
      look: " Terminal ",
      cards: "profile, upstream\nstats upstream",
      headline: "  DevOps   engineer ",
      programs: "AWS Community Builder\n\nLFX Mentee\n",
      blog: "https://blog.example.com/rss.xml",
    });
    assert.equal(o.look, "terminal");
    assert.deepEqual(o.cards, ["profile", "upstream", "stats"]);
    assert.equal(o.headline, "DevOps engineer");
    assert.deepEqual(o.programs, ["AWS Community Builder", "LFX Mentee"]);
    assert.deepEqual(o.feeds, ["https://blog.example.com/rss.xml"]);
  });

  it("explains mistakes", () => {
    assert.throws(() => parseOptions({ look: "neon" }), (e: Error) => e instanceof OptionsError && /terminal, clean, ops, playful/.test(e.message));
    assert.throws(() => parseOptions({ cards: "stats, gists" }), /Unknown card "gists"/);
    assert.throws(() => parseOptions({ blog: "http://insecure.example.com/rss" }), /https/);
    assert.throws(() => parseOptions({ headline: "x".repeat(81) }), /80 characters/);
  });

  it("validates GitHub usernames", () => {
    for (const ok of ["Suraj-kumar00", "a", "a-b-c"]) assert.ok(isLogin(ok), ok);
    for (const bad of ["-a", "a-", "a--b", "a b", "a/b", "x".repeat(40), ""]) assert.ok(!isLogin(bad), bad);
  });
});

describe("output", () => {
  const view = buildView(demoProfile(new Date("2026-09-26T12:00:00Z")));

  it("writes a dark and a light file per card, with stable names", () => {
    const files = renderCards(view, "ops", ["profile", "upstream"]);
    assert.deepEqual(files.map((f) => f.path), ["profile-dark.svg", "profile-light.svg", "upstream-dark.svg", "upstream-light.svg"]);
  });

  it("builds a README snippet that links each card to its proof", () => {
    const snippet = readmeSnippet("ada-ops", ["upstream", "stats"]);
    assert.ok(snippet.includes("https://raw.githubusercontent.com/ada-ops/ada-ops/readmeops/upstream-dark.svg"));
    assert.ok(snippet.includes('media="(prefers-color-scheme: dark)"'));
    assert.equal(cardLink("upstream", "ada-ops"), "https://github.com/search?q=author%3Aada-ops+is%3Apr+is%3Amerged+-user%3Aada-ops&type=pullrequests");
  });

  it("generates a workflow with only the settings in use", () => {
    const plain = workflowYaml("ada-ops", parseOptions({}));
    assert.ok(plain.includes("uses: Suraj-kumar00/readmeops@v0"));
    assert.ok(plain.includes("permissions:\n  contents: write"));
    assert.ok(!plain.includes("headline:") && !plain.includes("programs:") && !plain.includes("blog:"));
    const full = workflowYaml("ada-ops", parseOptions({ headline: 'Says "hi": yes', programs: "One\nTwo", blog: "https://b.example.com/feed" }));
    assert.ok(full.includes('headline: "Says \\"hi\\": yes"'));
    assert.ok(full.includes("programs: |\n            One\n            Two"));
    assert.match(full, /cron: "\d{1,2} \*\/6 \* \* \*"/);
  });

  it("prefills GitHub's new file page", () => {
    const url = newWorkflowUrl("ada-ops", "main", "name: readmeops\n");
    assert.equal(url, "https://github.com/ada-ops/ada-ops/new/main?filename=.github%2Fworkflows%2Freadmeops.yml&value=name%3A%20readmeops%0A");
  });
});
