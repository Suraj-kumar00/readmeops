import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildView, CARD_IDS, demoProfile, emptyProfile, LOOK_IDS, LOOKS, SCHEMES } from "../src/index.ts";
import { parseXml } from "../src/util/xml.ts";

const now = new Date("2026-09-26T12:00:00Z");
const HOSTILE = `</text><script>alert(1)</script><a href="javascript:x">&amp;"'`;

function hostileView() {
  const data = demoProfile(now);
  data.user.name = HOSTILE;
  data.headline = HOSTILE;
  data.programs = [HOSTILE];
  data.repos[0]!.description = HOSTILE;
  data.repos[0]!.name = `repo${HOSTILE}`;
  data.upstream.items[0]!.title = HOSTILE;
  data.posts[0]!.title = HOSTILE;
  return buildView(data);
}

const cases = [
  ["demo", buildView(demoProfile(now))],
  ["empty account", buildView(emptyProfile("newbie", "public", now))],
  ["hostile text", hostileView()],
] as const;

describe("looks", () => {
  for (const look of LOOK_IDS) {
    for (const [label, view] of cases) {
      it(`${look}: every card renders safely for ${label}`, () => {
        for (const card of CARD_IDS) {
          for (const scheme of SCHEMES) {
            const svg = LOOKS[look].render(card, view, scheme);
            const where = `${look}/${card}/${scheme}`;
            assert.doesNotThrow(() => parseXml(svg, true), `${where} is well-formed XML`);
            assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), where);
            assert.ok(!/<script|<foreignObject|<[^>]*\son[a-z]+\s*=|(?:href|src)\s*=\s*"javascript:/i.test(svg), `${where} has no active content`);
            const urls = svg.match(/(?:href|src)="(?!data:|#)[^"]*"/g) ?? [];
            assert.deepEqual(urls, [], `${where} loads nothing external`);
            assert.ok(/url\(data:font\/woff2;base64,/.test(svg), `${where} embeds its fonts`);
            assert.ok(svg.includes("prefers-reduced-motion"), `${where} respects reduced motion`);
            assert.ok(svg.length < 150_000, `${where} is ${svg.length} bytes`);
          }
        }
      });
    }
  }

  it("shows the same numbers in every look", () => {
    const view = buildView(demoProfile(now));
    const n = String(view.stats.mergedUpstream);
    for (const look of LOOK_IDS) {
      const svg = LOOKS[look].render("stats", view, "dark");
      assert.ok(svg.includes(`>${n}<`), `${look} shows ${n} merged pull requests`);
    }
  });

  it("is deterministic, so unchanged data never causes a push", () => {
    for (const look of LOOK_IDS) {
      const a = LOOKS[look].render("activity", buildView(demoProfile(now)), "light");
      const b = LOOKS[look].render("activity", buildView(demoProfile(now)), "light");
      assert.equal(a, b, look);
    }
  });
});
