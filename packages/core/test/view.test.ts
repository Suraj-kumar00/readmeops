import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildView, demoProfile, emptyProfile } from "../src/index.ts";

const now = new Date("2026-09-26T12:00:00Z");

describe("view model", () => {
  const data = demoProfile(now);
  const v = buildView(data);

  it("covers exactly the last 365 days", () => {
    const days = v.weeks.reduce((s, w) => s + w.total, 0);
    assert.equal(days, v.stats.contributions);
    assert.equal(v.stats.contributions, data.contributions.days.reduce((s, d) => s + d.count, 0));
    assert.ok(v.weeks.length === 53 || v.weeks.length === 54, `weeks: ${v.weeks.length}`);
    assert.equal(v.months.length, 12);
    assert.equal(v.months.at(-1)!.key, "2026-09");
  });

  it("computes streaks from real day runs", () => {
    assert.ok(v.stats.currentStreak >= 9, "the demo ends on a 9 day streak");
    assert.ok(v.stats.longestStreak >= v.stats.currentStreak);
  });

  it("groups upstream pull requests by repository, ranked by project and change size", () => {
    assert.equal(v.stats.mergedUpstream, data.upstream.total);
    assert.equal(v.upstream.reduce((s, u) => s + u.merged, 0), data.upstream.items.length);
    const weight = (u: (typeof v.upstream)[number]) => Math.log10(u.stars + 10) * Math.log10(10 + u.changedLines);
    for (let i = 1; i < v.upstream.length; i++) assert.ok(weight(v.upstream[i - 1]!) >= weight(v.upstream[i]!));
    const tiny = buildView({
      ...data,
      upstream: {
        total: 2,
        items: [
          { ...data.upstream.items[0]!, changedLines: 2, repo: { ...data.upstream.items[0]!.repo, nameWithOwner: "famous/repo", stars: 90_000 } },
          { ...data.upstream.items[1]!, changedLines: 4_000, repo: { ...data.upstream.items[1]!.repo, nameWithOwner: "small/tool", stars: 900 } },
        ],
      },
    });
    assert.equal(tiny.upstream[0]!.repo, "small/tool", "real work outranks a two-line change to a famous repo");
    const latest = v.upstream[0]!;
    const newest = data.upstream.items.filter((p) => p.repo.nameWithOwner === latest.repo).map((p) => p.mergedAt).sort().at(-1);
    assert.equal(latest.latest.mergedAt, newest);
  });

  it("builds a 12 month timeline per organization", () => {
    assert.equal(v.timeline.months.length, 12);
    for (const row of v.timeline.rows) assert.equal(row.counts.length, 12);
    const inWindow = data.upstream.items.filter((p) => p.mergedAt.slice(0, 7) >= v.timeline.months[0]!).length;
    const counted = v.timeline.rows.reduce((s, row) => s + row.counts.reduce((a, b) => a + b, 0), 0);
    assert.ok(counted <= inWindow);
  });

  it("measures languages by code size and keeps shares summing to one", () => {
    const sum = v.languages.reduce((s, l) => s + l.share, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
    assert.equal(v.languages[0]!.name, "HCL", "HCL has the most bytes in the demo");
  });

  it("uses the headline input first, then the bio", () => {
    assert.equal(v.headline, data.headline);
    const fromBio = buildView({ ...data, headline: null });
    assert.equal(fromBio.headline, "I make clusters boring and pipelines fast");
    assert.deepEqual(fromBio.tagline, ["Kubernetes", "MLOps"]);
    assert.deepEqual(v.tagline, ["I make clusters boring and pipelines fast", "Kubernetes"], "bio parts already in the headline are dropped");
  });

  it("excludes the profile repository from showcased repos", () => {
    const withProfileRepo = { ...data, repos: [...data.repos, { ...data.repos[0]!, name: "ada-ops", nameWithOwner: "ada-ops/ada-ops", stars: 9999 }] };
    assert.ok(!buildView(withProfileRepo).repos.some((r) => r.name === "ada-ops"));
  });

  it("handles a brand new account with no data", () => {
    const empty = buildView(emptyProfile("newbie", "public", now));
    assert.equal(empty.stats.contributions, 0);
    assert.equal(empty.busiestWeek, null);
    assert.equal(empty.upstream.length, 0);
    assert.equal(empty.name, "newbie");
    assert.equal(empty.initial, "N");
  });
});
