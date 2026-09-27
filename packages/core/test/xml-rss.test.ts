import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFeed } from "../src/index.ts";
import { parseXml, XmlError } from "../src/util/xml.ts";

describe("xml", () => {
  it("strict mode catches malformed documents", () => {
    assert.throws(() => parseXml("<a><b></a>", true), XmlError);
    assert.throws(() => parseXml("<a>x & y</a>", true), XmlError);
    assert.throws(() => parseXml("<a x=1/>", true), XmlError);
    assert.throws(() => parseXml("<a/><b/>", true), XmlError);
    assert.doesNotThrow(() => parseXml('<a x="1&amp;2">&lt;ok&gt;<![CDATA[<raw>]]></a>', true));
  });

  it("never expands DTD entities", () => {
    const evil = `<!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><r>&b;</r>`;
    const doc = parseXml(evil);
    const r = doc.children.find((c) => typeof c !== "string");
    assert.ok(r && typeof r !== "string");
    assert.equal(r.children.join(""), "&b;");
  });
});

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Blog</title>
<item><title><![CDATA[Older & wiser]]></title><link>https://blog.example.com/older</link>
<pubDate>Mon, 02 Feb 2026 10:00:00 GMT</pubDate>
<description>&lt;p&gt;Hello &amp; welcome&lt;/p&gt;</description></item>
<item><title>Newest</title><link>https://blog.example.com/new</link>
<pubDate>Sat, 05 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom post</title>
<link rel="alternate" href="https://atom.example.com/p1"/><published>2026-03-01T00:00:00Z</published>
<summary>Short summary</summary></entry></feed>`;

describe("rss", () => {
  it("parses RSS items and sorts newest first", () => {
    const posts = parseFeed(RSS, "blog");
    assert.equal(posts.length, 2, "javascript: links are dropped");
    assert.equal(posts[0]!.title, "Newest");
    assert.equal(posts[1]!.title, "Older & wiser");
    assert.equal(posts[1]!.summary, "Hello & welcome");
  });

  it("parses Atom entries", () => {
    const posts = parseFeed(ATOM, "atom");
    assert.equal(posts.length, 1);
    assert.equal(posts[0]!.url, "https://atom.example.com/p1");
    assert.equal(posts[0]!.publishedAt, "2026-03-01T00:00:00.000Z");
  });
});
