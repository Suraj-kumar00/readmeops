// src/main.ts
import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// ../core/src/model/types.ts
function emptyProfile(login, mode, now) {
  return {
    schemaVersion: 2,
    mode,
    generatedAt: now.toISOString(),
    user: {
      login,
      name: null,
      bio: null,
      company: null,
      location: null,
      websiteUrl: null,
      twitterUsername: null,
      avatarUrl: `https://github.com/${login}.png`,
      avatarDataUri: null,
      url: `https://github.com/${login}`,
      createdAt: now.toISOString(),
      followers: 0
    },
    repos: [],
    contributions: { days: [], total: 0, restricted: 0 },
    upstream: { total: 0, items: [] },
    posts: [],
    programs: [],
    headline: null,
    warnings: []
  };
}

// ../core/src/privacy.ts
var PrivacyError = class extends Error {
  counts;
  constructor(counts) {
    const summary2 = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(", ");
    super(
      `Public build refused: the token can read private data (${summary2}). Keep the default GITHUB_TOKEN for your profile README; private work belongs in the owner-only view of the editor.`
    );
    this.name = "PrivacyError";
    this.counts = counts;
  }
};
function countPrivate(data) {
  return {
    repositories: data.repos.filter((r2) => r2.visibility === "private").length,
    pullRequests: data.upstream.items.filter((p) => p.repo.visibility === "private").length
  };
}
function assertPublicSafe(data) {
  const counts = countPrivate(data);
  if (Object.values(counts).some((n) => n > 0)) throw new PrivacyError(counts);
}

// ../core/src/sources/github/client.ts
var GitHubApiError = class extends Error {
  status;
  constructor(message, status) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
};
var RETRYABLE = /* @__PURE__ */ new Set([429, 500, 502, 503, 504]);
function createGitHubClient(opts) {
  const doFetch = opts.fetch ?? ((input2, init) => fetch(input2, init));
  const api = (opts.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 3e4;
  const sleep = opts.sleep ?? ((ms) => new Promise((r2) => setTimeout(r2, ms)));
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": opts.userAgent ?? "readmeops"
  };
  async function request(url, init) {
    let attempt = 0;
    for (; ; ) {
      let res = null;
      let networkError = null;
      try {
        res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        networkError = err;
      }
      const secondaryLimit = res !== null && res.status === 403 && (res.headers.get("retry-after") !== null || res.headers.get("x-ratelimit-remaining") === "0");
      const retryable = networkError !== null || res !== null && (RETRYABLE.has(res.status) || secondaryLimit);
      if (!retryable || attempt >= retries) {
        if (networkError !== null) {
          throw new GitHubApiError(`network error calling GitHub: ${networkError.message ?? "unknown"}`, 0);
        }
        return res;
      }
      const retryAfter = Number(res?.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1e3 : 1e3 * 2 ** attempt;
      attempt++;
      await sleep(wait);
    }
  }
  return {
    async graphql(query, variables = {}) {
      const res = await request(`${api}/graphql`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables })
      });
      if (!res.ok) {
        const hint = res.status === 401 ? " (check the token)" : "";
        throw new GitHubApiError(`GitHub GraphQL request failed with HTTP ${res.status}${hint}`, res.status);
      }
      const json = await res.json();
      if (!json.data) {
        const message = json.errors?.map((e) => e.message).join("; ") ?? "no data";
        throw new GitHubApiError(`GitHub GraphQL error: ${message}`, res.status);
      }
      return { data: json.data, errors: json.errors ?? [] };
    },
    async rest(path) {
      const res = await request(`${api}${path.startsWith("/") ? path : `/${path}`}`, { method: "GET", headers });
      if (!res.ok) throw new GitHubApiError(`GitHub REST ${path.split("?")[0]} failed with HTTP ${res.status}`, res.status);
      return await res.json();
    },
    async bytes(url, maxBytes) {
      const res = await request(url, { method: "GET", headers: { "User-Agent": headers["User-Agent"] } });
      if (!res.ok) return null;
      const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) return null;
      return { bytes: buf, contentType };
    }
  };
}

// ../core/src/util/text.ts
var INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
var LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function sanitizeXmlChars(value) {
  return value.replace(INVALID_XML, "").replace(LONE_SURROGATE, "\uFFFD");
}
function escapeXml(value) {
  return sanitizeXmlChars(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
var XML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'"
};
var HTML_ENTITIES = {
  ...XML_ENTITIES,
  nbsp: "\xA0",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  laquo: "\xAB",
  raquo: "\xBB",
  copy: "\xA9",
  reg: "\xAE",
  trade: "\u2122",
  middot: "\xB7",
  bull: "\u2022",
  lpar: "(",
  rpar: ")",
  colon: ":",
  times: "\xD7"
};
function decodeEntities(value, strict = false) {
  let invalid = false;
  const out = value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (match, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 1114111 || code >= 55296 && code <= 57343) {
        invalid = true;
        return match;
      }
      return String.fromCodePoint(code);
    }
    const table = strict ? XML_ENTITIES : HTML_ENTITIES;
    const hit = table[ref];
    if (hit === void 0) {
      if (strict) invalid = true;
      return match;
    }
    return hit;
  });
  if (strict && (invalid || /&(?!(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);)/.test(value))) return null;
  return out;
}
function stripHtml(html) {
  const noScripts = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const noTags = noScripts.replace(/<[^>]*>/g, " ");
  return (decodeEntities(noTags) ?? noTags).replace(/\s+/g, " ").trim();
}
function truncateChars(value, max) {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  if (max <= 1) return "\u2026";
  return chars.slice(0, max - 1).join("").trimEnd() + "\u2026";
}
function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ../core/src/sources/github/collect.ts
var USER_QUERY = `query($login: String!) {
  user(login: $login) {
    login name bio company location websiteUrl twitterUsername avatarUrl url createdAt
    followers { totalCount }
  }
}`;
var REPOS_QUERY = `query($login: String!, $after: String) {
  user(login: $login) {
    repositories(first: 50, after: $after, ownerAffiliations: [OWNER], isFork: false, orderBy: {field: STARGAZERS, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name nameWithOwner description url isPrivate isFork isArchived stargazerCount forkCount pushedAt
        owner { login }
        primaryLanguage { name color }
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } }
        repositoryTopics(first: 10) { nodes { topic { name } } }
      }
    }
  }
}`;
var CONTRIB_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      restrictedContributionsCount
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
}`;
var UPSTREAM_QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        title url number mergedAt additions deletions
        repository { nameWithOwner url stargazerCount isPrivate owner { login } }
      }
    }
  }
}`;
async function fetchUser(client, login) {
  const { data } = await client.graphql(USER_QUERY, { login });
  const u = data.user;
  if (!u) throw new Error(`GitHub user "${login}" was not found`);
  return {
    login: u.login,
    name: u.name,
    bio: u.bio,
    company: u.company,
    location: u.location,
    websiteUrl: u.websiteUrl,
    twitterUsername: u.twitterUsername,
    avatarUrl: u.avatarUrl,
    avatarDataUri: null,
    url: u.url,
    createdAt: u.createdAt,
    followers: u.followers.totalCount
  };
}
async function fetchRepos(client, login, max = 100) {
  const repos5 = [];
  let after = null;
  while (repos5.length < max) {
    const result = await client.graphql(REPOS_QUERY, { login, after });
    const conn = result.data.user?.repositories;
    if (!conn) break;
    for (const r2 of conn.nodes) {
      if (!r2) continue;
      repos5.push({
        nameWithOwner: r2.nameWithOwner,
        name: r2.name,
        owner: r2.owner.login,
        description: r2.description,
        url: r2.url,
        visibility: r2.isPrivate ? "private" : "public",
        isFork: r2.isFork,
        isArchived: r2.isArchived,
        stars: r2.stargazerCount,
        forks: r2.forkCount,
        primaryLanguage: r2.primaryLanguage,
        languages: r2.languages.edges.map((e) => ({ name: e.node.name, color: e.node.color, bytes: e.size })),
        topics: r2.repositoryTopics.nodes.map((t) => t.topic.name),
        pushedAt: r2.pushedAt
      });
    }
    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return repos5.slice(0, max);
}
async function fetchContributions(client, login, now) {
  const from = new Date(now.getTime() - 364 * 864e5);
  from.setUTCHours(0, 0, 0, 0);
  const { data } = await client.graphql(CONTRIB_QUERY, {
    login,
    from: from.toISOString(),
    to: now.toISOString()
  });
  const c = data.user?.contributionsCollection;
  if (!c) return { days: [], total: 0, restricted: 0 };
  const days = c.contributionCalendar.weeks.flatMap((w) => w.contributionDays).map((d) => ({ date: d.date, count: d.contributionCount })).sort((a, b) => a.date.localeCompare(b.date));
  return { days, total: c.contributionCalendar.totalContributions, restricted: c.restrictedContributionsCount };
}
async function fetchUpstream(client, login, max = 100) {
  const q = `author:${login} is:pr is:merged -user:${login} sort:created-desc`;
  const items = [];
  let total = 0;
  let after = null;
  while (items.length < max) {
    const result = await client.graphql(UPSTREAM_QUERY, { q, after });
    total = result.data.search.issueCount;
    for (const raw of result.data.search.nodes) {
      if (!raw.url || !raw.repository || raw.number === void 0 || !raw.mergedAt) continue;
      if (raw.repository.owner.login.toLowerCase() === login.toLowerCase()) continue;
      items.push({
        title: raw.title ?? "",
        url: raw.url,
        number: raw.number,
        mergedAt: raw.mergedAt,
        changedLines: (raw.additions ?? 0) + (raw.deletions ?? 0),
        repo: {
          nameWithOwner: raw.repository.nameWithOwner,
          owner: raw.repository.owner.login,
          url: raw.repository.url,
          stars: raw.repository.stargazerCount,
          visibility: raw.repository.isPrivate ? "private" : "public"
        }
      });
    }
    const info = result.data.search.pageInfo;
    if (!info.hasNextPage || !info.endCursor) break;
    after = info.endCursor;
  }
  items.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  return { total: Math.max(total, items.length), items: items.slice(0, max) };
}
async function fetchAvatarDataUri(client, avatarUrl) {
  const url = new URL(avatarUrl);
  if (url.hostname !== "avatars.githubusercontent.com") return null;
  url.searchParams.set("s", "160");
  const res = await client.bytes(url.toString(), 5e5);
  if (!res || !/^image\/(png|jpeg|gif|webp)$/.test(res.contentType)) return null;
  return `data:${res.contentType};base64,${bytesToBase64(res.bytes)}`;
}

// ../core/src/util/dates.ts
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var DAY_MS = 864e5;
function dateKey(date) {
  return date.toISOString().slice(0, 10);
}
function parseDateKey(key) {
  return /* @__PURE__ */ new Date(`${key.slice(0, 10)}T00:00:00Z`);
}
function addDays(key, days) {
  return dateKey(new Date(parseDateKey(key).getTime() + days * DAY_MS));
}
function weekday(key) {
  return parseDateKey(key).getUTCDay();
}
function shortMonth(key) {
  const m = Number(key.split("-")[1]);
  return MONTHS[m - 1] ?? "?";
}
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "";
  if (iso.length === 7) return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
function formatDayMonth(key) {
  const d = parseDateKey(key);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
function parseLooseDate(value) {
  if (!value) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function lastMonths(now, months) {
  const out = [];
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  for (let k = months - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(y, m - k, 1));
    out.push(dateKey(d).slice(0, 7));
  }
  return out;
}

// ../core/src/util/xml.ts
var XmlError = class extends Error {
};
function parseXml(input2, strict = false) {
  const root = { name: "#document", attrs: {}, children: [] };
  const stack = [root];
  const n = input2.length;
  let i = 0;
  const fail2 = (message) => {
    if (strict) throw new XmlError(`${message} at offset ${i}`);
  };
  const top = () => stack[stack.length - 1];
  const pushRaw = (text) => {
    if (text) top().children.push(text);
  };
  const pushText = (text) => {
    if (!text) return;
    const decoded = decodeEntities(text, strict);
    if (decoded === null) {
      fail2("invalid character reference or bare '&' in text");
      pushRaw(text);
      return;
    }
    pushRaw(decoded);
  };
  while (i < n) {
    const lt = input2.indexOf("<", i);
    if (lt === -1) {
      pushText(input2.slice(i));
      break;
    }
    if (lt > i) pushText(input2.slice(i, lt));
    i = lt;
    if (input2.startsWith("<!--", i)) {
      const end = input2.indexOf("-->", i + 4);
      if (end === -1) {
        fail2("unterminated comment");
        break;
      }
      i = end + 3;
      continue;
    }
    if (input2.startsWith("<![CDATA[", i)) {
      const end = input2.indexOf("]]>", i + 9);
      if (end === -1) {
        fail2("unterminated CDATA section");
        pushRaw(input2.slice(i + 9));
        break;
      }
      pushRaw(input2.slice(i + 9, end));
      i = end + 3;
      continue;
    }
    if (input2.startsWith("<?", i)) {
      const end = input2.indexOf("?>", i + 2);
      if (end === -1) {
        fail2("unterminated processing instruction");
        break;
      }
      i = end + 2;
      continue;
    }
    if (input2.startsWith("<!", i)) {
      let depth = 0;
      let j2 = i + 2;
      for (; j2 < n; j2++) {
        const c = input2[j2];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      i = j2 + 1;
      continue;
    }
    if (input2[i + 1] === "/") {
      const end = input2.indexOf(">", i);
      if (end === -1) {
        fail2("unterminated closing tag");
        break;
      }
      const name2 = input2.slice(i + 2, end).trim();
      let idx = stack.length - 1;
      while (idx > 0 && stack[idx].name !== name2) idx--;
      if (idx === 0) {
        fail2(`unexpected closing tag </${name2}>`);
      } else {
        if (idx !== stack.length - 1) fail2(`mismatched closing tag </${name2}> for <${top().name}>`);
        stack.length = idx;
      }
      i = end + 1;
      continue;
    }
    let j = i + 1;
    while (j < n && !/[\s/>]/.test(input2[j])) j++;
    const name = input2.slice(i + 1, j);
    if (!name || !/^[A-Za-z_][\w.:-]*$/.test(name)) {
      fail2(`invalid tag name "${name}"`);
      pushRaw("<");
      i++;
      continue;
    }
    const attrs = {};
    let selfClosing = false;
    let closed = false;
    while (j < n) {
      while (j < n && /\s/.test(input2[j])) j++;
      const c = input2[j];
      if (c === ">") {
        closed = true;
        j++;
        break;
      }
      if (c === "/" && input2[j + 1] === ">") {
        selfClosing = true;
        closed = true;
        j += 2;
        break;
      }
      let k = j;
      while (k < n && !/[\s=/>]/.test(input2[k])) k++;
      const attrName = input2.slice(j, k);
      if (!attrName) {
        fail2("malformed attribute");
        j = k + 1;
        continue;
      }
      while (k < n && /\s/.test(input2[k])) k++;
      if (input2[k] !== "=") {
        fail2(`attribute "${attrName}" has no value`);
        attrs[attrName] = "";
        j = k;
        continue;
      }
      k++;
      while (k < n && /\s/.test(input2[k])) k++;
      const quote = input2[k];
      let value;
      if (quote === '"' || quote === "'") {
        const endQuote = input2.indexOf(quote, k + 1);
        if (endQuote === -1) {
          fail2("unterminated attribute value");
          j = n;
          break;
        }
        value = input2.slice(k + 1, endQuote);
        j = endQuote + 1;
      } else {
        fail2(`attribute "${attrName}" value must be quoted`);
        let e = k;
        while (e < n && !/[\s>]/.test(input2[e])) e++;
        value = input2.slice(k, e);
        j = e;
      }
      if (strict && value.includes("<")) fail2(`'<' in attribute "${attrName}"`);
      if (strict && attrName in attrs) fail2(`duplicate attribute "${attrName}"`);
      const decoded = decodeEntities(value, strict);
      if (decoded === null) fail2(`invalid entity in attribute "${attrName}"`);
      attrs[attrName] = decoded ?? value;
    }
    if (!closed) {
      fail2(`unterminated tag <${name}>`);
      break;
    }
    const element = { name, attrs, children: [] };
    top().children.push(element);
    if (!selfClosing) stack.push(element);
    i = j;
  }
  if (stack.length > 1) fail2(`unclosed element <${top().name}>`);
  const elements = root.children.filter((c) => typeof c !== "string");
  if (strict && elements.length !== 1) throw new XmlError(`expected exactly one root element, found ${elements.length}`);
  return root;
}
function isElement(node) {
  return typeof node === "object" && node !== null;
}
function children(el, name) {
  return el.children.filter((c) => isElement(c) && (name === void 0 || c.name === name));
}
function child(el, ...names) {
  for (const name of names) {
    const hit = el.children.find((c) => isElement(c) && c.name === name);
    if (hit) return hit;
  }
  return void 0;
}
function textOf(el) {
  if (!el) return "";
  return el.children.map((c) => typeof c === "string" ? c : textOf(c)).join("");
}

// ../core/src/sources/rss.ts
function httpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
function summaryOf(bodies) {
  for (const body of bodies) {
    const text = stripHtml(body);
    if (text) return truncateChars(text, 220);
  }
  return null;
}
function parseFeed(xml, source) {
  const doc5 = parseXml(xml);
  const root = doc5.children.find((c) => typeof c !== "string");
  if (!root) return [];
  const posts = [];
  if (root.name === "feed") {
    for (const entry of children(root, "entry")) {
      const links = children(entry, "link");
      const alt = links.find((l) => !l.attrs["rel"] || l.attrs["rel"] === "alternate") ?? links[0];
      const url = httpUrl(alt?.attrs["href"]);
      if (!url) continue;
      posts.push({
        title: stripHtml(textOf(child(entry, "title"))) || url,
        url,
        publishedAt: parseLooseDate(textOf(child(entry, "published", "updated"))),
        summary: summaryOf([textOf(child(entry, "summary")), textOf(child(entry, "content"))].filter(Boolean)),
        source
      });
    }
  } else {
    const channel = child(root, "channel") ?? root;
    for (const item of [...children(channel, "item"), ...children(root, "item")]) {
      const url = httpUrl(textOf(child(item, "link")) || textOf(child(item, "guid")));
      if (!url) continue;
      posts.push({
        title: stripHtml(textOf(child(item, "title"))) || url,
        url,
        publishedAt: parseLooseDate(textOf(child(item, "pubDate", "dc:date", "published"))),
        summary: summaryOf([textOf(child(item, "description")), textOf(child(item, "content:encoded"))].filter(Boolean)),
        source
      });
    }
  }
  return posts.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}
async function collectPosts(feeds, opts) {
  const doFetch = opts.fetch ?? ((input2, init) => fetch(input2, init));
  const warnings = [];
  const all = [];
  for (const feed of feeds) {
    const source = new URL(feed).hostname;
    try {
      const res = await doFetch(feed, {
        headers: { Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5", "User-Agent": "readmeops" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 2e4)
      });
      if (!res.ok) {
        warnings.push(`feed ${source}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (text.length > 5e6) {
        warnings.push(`feed ${source}: larger than 5 MB, skipped`);
        continue;
      }
      all.push(...parseFeed(text, source));
    } catch (err) {
      warnings.push(`feed ${source}: ${err.message}`);
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const posts = all.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")).filter((p) => seen.has(p.url) ? false : (seen.add(p.url), true)).slice(0, opts.limit);
  return { posts, warnings };
}

// ../core/src/collect.ts
async function collectProfile(opts) {
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const log2 = opts.log ?? (() => {
  });
  const client = opts.client ?? createGitHubClient({ token: opts.token, ...opts.fetch ? { fetch: opts.fetch } : {} });
  const data = emptyProfile(opts.user, opts.mode, now);
  data.programs = opts.programs ?? [];
  data.headline = opts.headline ?? null;
  log2(`github: profile of ${opts.user}`);
  data.user = await fetchUser(client, opts.user);
  const login = data.user.login;
  log2("github: repositories");
  data.repos = await fetchRepos(client, login);
  log2("github: contribution calendar");
  data.contributions = await fetchContributions(client, login, now);
  log2("github: merged pull requests to other repositories");
  data.upstream = await fetchUpstream(client, login);
  try {
    data.user.avatarDataUri = await fetchAvatarDataUri(client, data.user.avatarUrl);
  } catch {
    data.warnings.push("avatar could not be downloaded; the profile card shows your initial instead");
  }
  if (opts.feeds && opts.feeds.length > 0) {
    log2(`rss: ${opts.feeds.length} feed(s)`);
    const { posts, warnings } = await collectPosts(opts.feeds, { limit: 6, ...opts.fetch ? { fetch: opts.fetch } : {} });
    data.posts = posts;
    data.warnings.push(...warnings);
  }
  if (opts.mode === "public") assertPublicSafe(data);
  return data;
}

// ../core/src/view.ts
var CARD_IDS = ["profile", "stats", "activity", "upstream", "languages", "repos", "writing"];
var TOPIC_STOPLIST = /* @__PURE__ */ new Set([
  "hacktoberfest",
  "open-source",
  "opensource",
  "good-first-issue",
  "awesome",
  "project",
  "projects",
  "learning",
  "beginner",
  "beginners",
  "portfolio",
  "readme",
  "profile",
  "github",
  "hacktoberfest2024",
  "hacktoberfest2025"
]);
function splitBio(bio) {
  if (!bio) return [];
  return bio.split(/\s*[|·•\n]\s*/).map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 60);
}
function displayUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return (u.host + u.pathname).replace(/^www\./, "").replace(/\/$/, "");
  } catch {
    return null;
  }
}
function streaks(days, today) {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  let cursor = (byDate.get(today) ?? 0) > 0 ? today : addDays(today, -1);
  let current = 0;
  while ((byDate.get(cursor) ?? 0) > 0) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { longest, current };
}
function lastYear(days, today) {
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const out = [];
  for (let i = 364; i >= 0; i--) {
    const date = addDays(today, -i);
    out.push({ date, count: byDate.get(date) ?? 0 });
  }
  return out;
}
function buildView(data) {
  const now = new Date(data.generatedAt);
  const today = dateKey(now);
  const login = data.user.login;
  const own = data.repos.filter((r2) => r2.owner.toLowerCase() === login.toLowerCase() && !r2.isFork);
  const showcase = own.filter((r2) => r2.name.toLowerCase() !== login.toLowerCase());
  const name = (data.user.name ?? "").trim() || login;
  const bioParts = splitBio(data.user.bio);
  const company = data.user.company?.replace(/^@/, "").trim() || null;
  const headline = data.headline?.trim() || bioParts[0] || company || null;
  const programsLower = new Set(data.programs.map((p) => p.toLowerCase()));
  const headlineLower = (headline ?? "").toLowerCase();
  const tagline = bioParts.slice(data.headline?.trim() ? 0 : 1).filter((p) => !programsLower.has(p.toLowerCase()) && !headlineLower.includes(p.toLowerCase())).slice(0, 3);
  const topics = /* @__PURE__ */ new Map();
  for (const r2 of showcase) for (const t of r2.topics) if (!TOPIC_STOPLIST.has(t)) topics.set(t, (topics.get(t) ?? 0) + 1);
  const focus = [...topics.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([t]) => t);
  const days = lastYear(data.contributions.days, today);
  const total = days.reduce((s, d) => s + d.count, 0);
  const activeDays = days.filter((d) => d.count > 0).length;
  const { longest, current } = streaks(days, today);
  const weekMap = /* @__PURE__ */ new Map();
  for (const d of days) {
    const start = addDays(d.date, -weekday(d.date));
    weekMap.set(start, (weekMap.get(start) ?? 0) + d.count);
  }
  const weeks = [...weekMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([start, t]) => ({ start, total: t }));
  const busiestWeek = weeks.reduce((best, w) => w.total > 0 && (!best || w.total > best.total) ? w : best, null);
  const bestDay = days.reduce((best, d) => d.count > 0 && (!best || d.count > best.count) ? d : best, null);
  const monthKeys = lastMonths(now, 12);
  const months = monthKeys.map((key) => ({ key, total: 0, merged: 0, activeDays: 0 }));
  const monthIndex = new Map(monthKeys.map((k, i) => [k, i]));
  for (const d of days) {
    const i = monthIndex.get(d.date.slice(0, 7));
    if (i === void 0) continue;
    months[i].total += d.count;
    if (d.count > 0) months[i].activeDays++;
  }
  const items = data.upstream.items;
  const byRepo = /* @__PURE__ */ new Map();
  for (const pr of items) {
    const key = pr.repo.nameWithOwner.toLowerCase();
    const i = monthIndex.get(pr.mergedAt.slice(0, 7));
    if (i !== void 0) months[i].merged++;
    const cur = byRepo.get(key);
    if (cur) {
      cur.merged++;
      cur.changedLines += pr.changedLines;
      if (pr.mergedAt > cur.latest.mergedAt) cur.latest = { title: pr.title, url: pr.url, mergedAt: pr.mergedAt };
    } else {
      byRepo.set(key, {
        repo: pr.repo.nameWithOwner,
        owner: pr.repo.owner,
        url: pr.repo.url,
        stars: pr.repo.stars,
        merged: 1,
        changedLines: pr.changedLines,
        latest: { title: pr.title, url: pr.url, mergedAt: pr.mergedAt }
      });
    }
  }
  const weight = (u) => Math.log10(u.stars + 10) * Math.log10(10 + u.changedLines);
  const upstream5 = [...byRepo.values()].sort(
    (a, b) => weight(b) - weight(a) || b.stars - a.stars || b.latest.mergedAt.localeCompare(a.latest.mergedAt)
  );
  const owners = new Set(items.map((p) => p.repo.owner.toLowerCase()));
  const rows = /* @__PURE__ */ new Map();
  for (const pr of items) {
    const i = monthIndex.get(pr.mergedAt.slice(0, 7));
    if (i === void 0) continue;
    const key = pr.repo.owner.toLowerCase();
    let row = rows.get(key);
    if (!row) {
      row = { label: pr.repo.owner, url: `https://github.com/${pr.repo.owner}`, counts: new Array(12).fill(0), last: pr.mergedAt, repos: /* @__PURE__ */ new Set() };
      rows.set(key, row);
    }
    row.counts[i]++;
    row.repos.add(pr.repo.nameWithOwner);
    if (pr.mergedAt > row.last) row.last = pr.mergedAt;
  }
  const timelineRows = [...rows.values()].sort((a, b) => b.last.localeCompare(a.last)).slice(0, 6).map((row) => {
    const only = row.repos.size === 1 ? [...row.repos][0] : null;
    return { label: only ?? row.label, url: only ? `https://github.com/${only}` : row.url, counts: row.counts };
  });
  const bytes = /* @__PURE__ */ new Map();
  for (const r2 of own) {
    for (const l of r2.languages) {
      const cur = bytes.get(l.name) ?? { color: l.color, value: 0 };
      cur.value += l.bytes;
      bytes.set(l.name, cur);
    }
  }
  const totalBytes = [...bytes.values()].reduce((s, v) => s + v.value, 0);
  const sorted = [...bytes.entries()].sort((a, b) => b[1].value - a[1].value || a[0].localeCompare(b[0]));
  const languages5 = sorted.slice(0, 6).map(([n, v]) => ({ name: n, color: v.color, share: totalBytes ? v.value / totalBytes : 0 }));
  const rest = sorted.slice(6).reduce((s, [, v]) => s + v.value, 0);
  if (rest > 0 && totalBytes) languages5.push({ name: "Other", color: null, share: rest / totalBytes });
  const repos5 = [...showcase].sort((a, b) => b.stars - a.stars || b.forks - a.forks || (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "")).slice(0, 6).map((r2) => ({
    name: r2.name,
    url: r2.url,
    description: r2.description,
    stars: r2.stars,
    forks: r2.forks,
    language: r2.primaryLanguage?.name ?? null,
    languageColor: r2.primaryLanguage?.color ?? null,
    archived: r2.isArchived,
    pushedAt: r2.pushedAt
  }));
  const posts = data.posts.slice(0, 5).map((p) => ({ title: p.title, url: p.url, date: p.publishedAt ? p.publishedAt.slice(0, 10) : null }));
  return {
    mode: data.mode,
    generatedAt: data.generatedAt,
    today,
    login,
    name,
    initial: [...name][0].toUpperCase(),
    headline,
    tagline,
    location: data.user.location?.trim() || null,
    website: displayUrl(data.user.websiteUrl),
    websiteUrl: data.user.websiteUrl ? /^https?:\/\//i.test(data.user.websiteUrl) ? data.user.websiteUrl : `https://${data.user.websiteUrl}` : null,
    avatar: data.user.avatarDataUri,
    since: data.user.createdAt.slice(0, 7),
    followers: data.user.followers,
    programs: data.programs,
    focus,
    stats: {
      mergedUpstream: data.upstream.total,
      upstreamRepos: byRepo.size,
      upstreamOwners: owners.size,
      stars: own.reduce((s, r2) => s + r2.stars, 0),
      forks: own.reduce((s, r2) => s + r2.forks, 0),
      repos: own.length,
      contributions: total,
      activeDays,
      longestStreak: longest,
      currentStreak: current,
      followers: data.user.followers
    },
    weeks,
    months,
    busiestWeek,
    bestDay,
    languages: languages5,
    upstream: upstream5,
    timeline: { months: monthKeys, rows: timelineRows },
    repos: repos5,
    posts,
    blogHost: data.posts[0]?.source ?? null
  };
}

// ../core/src/fonts/data.ts
var CODEPOINTS = [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 8211, 8212, 8216, 8217, 8220, 8221, 8226, 8230, 8722];
var FACES = {
  "mono-400": { family: "RO Mono", weight: 400, upm: 1e3, advances: [600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600], woff2: "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" },
  "mono-700": { family: "RO Mono", weight: 700, upm: 1e3, advances: [600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600], woff2: "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" },
  "sans-400": { family: "RO Sans", weight: 400, upm: 1e3, advances: [250, 217, 360, 478, 649, 770, 622, 188, 313, 313, 436, 570, 203, 426, 203, 483, 672, 385, 619, 613, 636, 626, 624, 585, 604, 624, 293, 293, 549, 660, 553, 567, 914, 672, 681, 702, 703, 604, 591, 709, 704, 272, 598, 653, 581, 878, 739, 748, 651, 742, 673, 649, 578, 690, 670, 912, 629, 631, 543, 337, 478, 337, 402, 564, 252, 576, 599, 553, 599, 568, 399, 598, 582, 246, 261, 591, 284, 878, 582, 580, 599, 599, 383, 531, 397, 576, 538, 820, 587, 538, 550, 424, 264, 424, 538, 250, 217, 553, 616, 587, 631, 264, 558, 328, 836, 576, 538, 485, 432, 602, 350, 396, 570, 600, 600, 252, 594, 593, 203, 310, 600, 580, 538, 957, 976, 973, 567, 672, 672, 672, 672, 672, 672, 977, 702, 604, 604, 604, 604, 272, 272, 272, 272, 791, 739, 748, 748, 748, 748, 748, 487, 753, 690, 690, 690, 690, 631, 621, 591, 576, 576, 576, 576, 576, 576, 932, 553, 568, 568, 568, 568, 246, 246, 246, 246, 595, 582, 580, 580, 580, 580, 580, 570, 566, 576, 576, 576, 576, 538, 599, 538, 598, 914, 207, 207, 374, 374, 297, 573, 570], woff2: "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" },
  "sans-500": { family: "RO Sans", weight: 500, upm: 1e3, advances: [243, 230, 369, 515, 659, 794, 651, 192, 325, 325, 433, 565, 215, 425, 215, 496, 680, 406, 630, 626, 651, 641, 636, 589, 625, 638, 298, 298, 545, 648, 549, 577, 930, 695, 688, 711, 708, 610, 596, 718, 709, 282, 608, 670, 584, 890, 742, 756, 658, 750, 681, 659, 596, 695, 694, 938, 659, 652, 561, 352, 492, 352, 408, 564, 256, 590, 611, 569, 611, 582, 416, 611, 592, 258, 284, 610, 299, 885, 592, 594, 611, 611, 398, 546, 414, 587, 562, 830, 608, 555, 565, 426, 275, 426, 532, 243, 230, 569, 626, 584, 652, 275, 572, 365, 831, 590, 577, 480, 430, 597, 356, 403, 573, 600, 600, 255, 605, 614, 215, 315, 600, 594, 577, 954, 973, 972, 577, 695, 695, 695, 695, 695, 695, 1001, 711, 610, 610, 610, 610, 282, 282, 282, 282, 792, 742, 756, 756, 756, 756, 756, 492, 761, 695, 695, 695, 695, 652, 628, 613, 590, 590, 590, 590, 590, 590, 943, 569, 582, 582, 582, 582, 258, 258, 258, 258, 602, 592, 594, 594, 594, 594, 594, 565, 580, 587, 587, 587, 587, 555, 608, 555, 598, 914, 219, 219, 402, 402, 310, 614, 565], woff2: "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" },
  "sans-600": { family: "RO Sans", weight: 600, upm: 1e3, advances: [236, 243, 378, 552, 669, 817, 680, 195, 336, 336, 429, 559, 227, 423, 227, 510, 689, 428, 642, 640, 665, 656, 648, 592, 646, 651, 304, 304, 541, 636, 545, 586, 945, 719, 696, 720, 714, 616, 600, 727, 713, 291, 617, 688, 586, 903, 745, 765, 665, 759, 689, 669, 614, 699, 717, 965, 689, 674, 579, 368, 506, 368, 414, 565, 261, 605, 624, 586, 624, 596, 432, 623, 601, 270, 308, 629, 313, 893, 601, 608, 624, 624, 412, 562, 431, 597, 586, 840, 630, 571, 581, 429, 285, 429, 527, 236, 243, 586, 636, 580, 674, 285, 587, 402, 825, 605, 616, 474, 427, 591, 362, 409, 576, 600, 600, 258, 616, 635, 227, 319, 600, 608, 616, 952, 971, 971, 586, 719, 719, 719, 719, 719, 719, 1026, 720, 616, 616, 616, 616, 291, 291, 291, 291, 794, 745, 765, 765, 765, 765, 765, 496, 768, 699, 699, 699, 699, 674, 634, 636, 605, 605, 605, 605, 605, 605, 955, 586, 596, 596, 596, 596, 270, 270, 270, 270, 610, 601, 608, 608, 608, 608, 608, 559, 593, 597, 597, 597, 597, 571, 617, 571, 599, 915, 231, 231, 430, 430, 322, 655, 559], woff2: "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" },
  "code-400": { family: "RO Code", weight: 400, upm: 1e3, advances: [600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 0, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600, 600], woff2: "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" },
  "cond-600": { family: "RO Cond", weight: 600, upm: 1e3, advances: [200, 302, 315, 642, 501, 802, 635, 153, 298, 298, 380, 465, 232, 364, 242, 417, 509, 313, 488, 478, 522, 478, 479, 440, 484, 480, 304, 266, 465, 465, 465, 456, 789, 552, 542, 533, 545, 513, 489, 537, 557, 243, 512, 549, 493, 627, 588, 544, 526, 521, 537, 513, 516, 557, 540, 771, 538, 528, 480, 366, 417, 366, 439, 457, 213, 478, 498, 477, 498, 484, 333, 490, 491, 235, 231, 478, 219, 747, 491, 490, 502, 502, 342, 446, 328, 489, 460, 677, 466, 446, 412, 334, 180, 334, 501, 200, 302, 477, 561, 551, 607, 180, 449, 361, 821, 305, 492, 465, 364, 441, 338, 368, 465, 298, 299, 213, 496, 553, 220, 150, 172, 324, 492, 758, 741, 841, 456, 552, 552, 552, 552, 552, 552, 841, 533, 513, 513, 513, 513, 243, 243, 243, 243, 591, 588, 544, 544, 544, 544, 544, 413, 609, 557, 557, 557, 557, 528, 516, 509, 477, 477, 477, 477, 477, 477, 755, 477, 483, 483, 483, 483, 205, 205, 205, 205, 493, 491, 488, 488, 488, 488, 488, 465, 497, 491, 491, 491, 491, 446, 490, 446, 422, 630, 173, 173, 322, 322, 308, 755, 465], woff2: "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" },
  "display-500": { family: "RO Display", weight: 500, upm: 1e3, advances: [246, 266, 317, 612, 630, 947, 756, 158, 305, 290, 395, 516, 165, 339, 196, 353, 656, 320, 583, 595, 595, 599, 646, 493, 645, 640, 207, 187, 516, 516, 516, 413, 952, 671, 666, 670, 691, 599, 578, 706, 708, 274, 357, 666, 508, 908, 746, 716, 629, 719, 660, 641, 553, 719, 657, 957, 652, 600, 560, 315, 341, 300, 546, 578, 283, 567, 618, 555, 617, 570, 380, 588, 608, 259, 266, 561, 257, 912, 608, 604, 618, 617, 411, 535, 380, 599, 546, 827, 534, 591, 500, 353, 259, 331, 516, 246, 266, 555, 717, 0, 589, 259, 555, 364, 922, 414, 420, 516, 0, 656, 318, 350, 516, 411, 410, 283, 611, 659, 196, 281, 248, 414, 420, 886, 895, 1035, 404, 671, 671, 671, 671, 671, 671, 917, 670, 599, 599, 599, 599, 274, 274, 274, 274, 747, 746, 716, 716, 716, 716, 716, 516, 722, 719, 719, 719, 719, 600, 633, 665, 567, 567, 567, 567, 567, 567, 907, 555, 570, 570, 570, 570, 258, 258, 258, 258, 597, 608, 604, 604, 604, 604, 604, 516, 604, 599, 599, 599, 599, 591, 617, 591, 520, 767, 176, 176, 346, 346, 271, 706, 516], woff2: "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" },
  "display-800": { family: "RO Display", weight: 800, upm: 1e3, advances: [223, 303, 381, 633, 647, 992, 754, 187, 329, 329, 456, 534, 212, 359, 252, 365, 670, 360, 613, 611, 638, 615, 662, 517, 661, 658, 262, 237, 534, 534, 534, 425, 1004, 712, 692, 685, 705, 632, 601, 729, 730, 303, 382, 697, 509, 955, 790, 725, 654, 726, 688, 658, 579, 733, 682, 1001, 719, 662, 576, 329, 365, 329, 585, 543, 283, 595, 648, 571, 649, 587, 408, 607, 643, 286, 288, 605, 283, 963, 643, 612, 648, 649, 446, 549, 406, 634, 585, 881, 587, 608, 537, 347, 277, 347, 534, 223, 303, 571, 718, 0, 649, 277, 573, 399, 978, 438, 484, 534, 0, 701, 348, 364, 534, 441, 425, 283, 653, 718, 252, 308, 265, 428, 484, 965, 962, 1109, 425, 712, 712, 712, 712, 712, 712, 972, 685, 632, 632, 632, 632, 303, 303, 303, 303, 748, 790, 725, 725, 725, 725, 725, 534, 736, 733, 733, 733, 733, 662, 653, 691, 595, 595, 595, 595, 595, 595, 937, 571, 587, 587, 587, 587, 286, 286, 286, 286, 619, 643, 612, 612, 612, 612, 612, 534, 612, 634, 634, 634, 634, 608, 648, 608, 545, 821, 219, 219, 426, 426, 356, 795, 534], woff2: "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" }
};

// ../core/src/fonts/index.ts
var INDEX = new Map(CODEPOINTS.map((cp, i) => [cp, i]));
var STACK = {
  mono: "'RO Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
  sans: "'RO Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
  code: "'RO Code',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
  cond: "'RO Cond','Roboto Condensed','Arial Narrow',ui-sans-serif,sans-serif",
  display: "'RO Display',ui-rounded,ui-sans-serif,system-ui,sans-serif"
};
function fontFaces(keys) {
  return [...new Set(keys)].map((k) => {
    const f = FACES[k];
    return `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,${f.woff2}) format('woff2')}`;
  }).join("");
}
function measure(key, text, size, letterSpacing = 0) {
  const f = FACES[key];
  const fallback = f.family === "RO Mono" || f.family === "RO Code" ? 600 : Math.round(f.upm * 0.56);
  let units = 0;
  let n = 0;
  for (const ch of text) {
    const i = INDEX.get(ch.codePointAt(0));
    const adv = i === void 0 ? 0 : f.advances[i];
    units += adv > 0 ? adv : fallback;
    n++;
  }
  return units * size / f.upm + letterSpacing * Math.max(0, n - 1);
}
function fit(key, text, size, maxWidth, letterSpacing = 0) {
  const clean2 = text.replace(/\s+/g, " ").trim();
  if (measure(key, clean2, size, letterSpacing) <= maxWidth) return clean2;
  const chars = [...clean2];
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = chars.slice(0, mid).join("").trimEnd() + "\u2026";
    if (measure(key, candidate, size, letterSpacing) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "\u2026" : chars.slice(0, lo).join("").replace(/[\s,.;:\-|/]+$/, "") + "\u2026";
}
function wrap(key, text, size, maxWidth, maxLines) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines2 = [];
  let current = "";
  for (let i = 0; i < words.length; i++) {
    const next = current ? `${current} ${words[i]}` : words[i];
    if (measure(key, next, size) <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines2.push(current);
    current = words[i];
    if (lines2.length === maxLines - 1) {
      current = words.slice(i).join(" ");
      break;
    }
  }
  if (current) lines2.push(current);
  const out = lines2.slice(0, maxLines);
  const last = out.length - 1;
  if (last >= 0) out[last] = fit(key, out[last], size, maxWidth);
  return out;
}

// ../core/src/render/svg.ts
var esc = escapeXml;
function r(value) {
  return String(Math.round(value * 10) / 10);
}
function svgDoc(o) {
  const desc = o.desc ? `<desc>${esc(o.desc)}</desc>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${o.height}" viewBox="0 0 ${o.width} ${o.height}" role="img" aria-label="${esc(o.title)}"><title>${esc(o.title)}</title>${desc}<style>${fontFaces(o.fonts)}${o.css}</style>${o.body}</svg>`;
}
function rgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
function mix(a, b, t) {
  const ca = rgb(a);
  const cb = rgb(b);
  return "#" + ca.map((x, i) => Math.round(x + (cb[i] - x) * Math.min(1, Math.max(0, t))).toString(16).padStart(2, "0")).join("");
}
function hueOf(value) {
  let h = 0;
  for (const ch of value.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function starPath(cx, cy, outer, inner, points = 5, rotation = 0) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI * i / points + rotation;
    const rad = i % 2 === 0 ? outer : inner;
    pts.push(`${r(cx + rad * Math.sin(a))} ${r(cy - rad * Math.cos(a))}`);
  }
  return `M${pts.join(" L")} Z`;
}
function linePath(points) {
  if (points.length < 2) return "";
  return "M" + points.map(([x, y]) => `${r(x)} ${r(y)}`).join(" L");
}
var REDUCED_MOTION = (selectors) => `@media (prefers-reduced-motion:reduce){${selectors}{animation:none!important}}`;

// ../core/src/util/format.ts
function formatInt(value) {
  const n = Math.round(value);
  const sign = n < 0 ? "-" : "";
  return sign + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function compactNumber(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs < 1e3) return sign + String(Math.round(abs));
  const units = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"]
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = abs / size;
      const text = scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, "");
      return `${sign}${text}${suffix}`;
    }
  }
  return sign + String(abs);
}

// ../core/src/looks/types.ts
var SCHEMES = ["dark", "light"];
var LOOK_IDS = ["terminal", "clean", "ops", "playful"];
var CARD_WIDTH = 840;

// ../core/src/looks/clean.ts
var PAL = {
  dark: {
    card: "#0f1114",
    border: "#23272e",
    text: "#ededee",
    sub: "#a8adb5",
    muted: "#7c828c",
    grid: "#1b1f25",
    accent: "#8b93ff",
    accent2: "#5c63d9",
    track: "#1a1e24",
    pill: "#15181d",
    dark: true
  },
  light: {
    card: "#ffffff",
    border: "#e4e6ea",
    text: "#16181c",
    sub: "#4b5058",
    muted: "#6e747d",
    grid: "#f0f1f3",
    accent: "#4b53d6",
    accent2: "#a4a9f2",
    track: "#eff0f3",
    pill: "#f7f7f8",
    dark: false
  }
};
var R4 = "sans-400";
var R5 = "sans-500";
var R6 = "sans-600";
var MO = "code-400";
var CSS = `.r{font-family:${STACK.sans};font-weight:400}.m{font-family:${STACK.sans};font-weight:500}.s{font-family:${STACK.sans};font-weight:600}.mono{font-family:${STACK.code};font-weight:400}@keyframes breathe{0%,100%{opacity:1}50%{opacity:.55}}.peak{animation:breathe 2.4s ease-in-out infinite}` + REDUCED_MOTION(".peak");
function T(x, y, text, fill, size, cls = "r", extra = "") {
  return `<text x="${r(x)}" y="${r(y)}" class="${cls}" font-size="${size}" fill="${fill}"${extra}>${esc(text)}</text>`;
}
function card(P, h) {
  return `<rect x=".5" y=".5" width="${CARD_WIDTH - 1}" height="${h - 1}" rx="12" fill="${P.card}" stroke="${P.border}"/>`;
}
function heading(P, title, detail, right) {
  const s = [T(24, 40, title, P.text, 15, "m")];
  s.push(T(24 + measure(R5, title, 15) + 10, 40, fit(R4, detail, 15, CARD_WIDTH - 300 - measure(R5, title, 15)), P.muted, 15));
  if (right) s.push(T(CARD_WIDTH - 24, 40, right, P.muted, 12.5, "r", ' text-anchor="end"'));
  return s.join("");
}
function doc(title, h, fonts, body, desc) {
  return svgDoc({ width: CARD_WIDTH, height: h, title, ...desc ? { desc } : {}, fonts, css: CSS, body });
}
function emptyNote(P, y, text) {
  return T(24, y, text, P.muted, 13.5);
}
function spark(values, x, y, w, h, color) {
  if (values.length < 2 || Math.max(...values) === 0) return "";
  const mx = Math.max(...values);
  const pts = values.map((v, i) => [x + i * w / (values.length - 1), y + h - v / mx * h]);
  const line = linePath(pts);
  return `<path d="${line} L${r(x + w)} ${r(y + h)} L${r(x)} ${r(y + h)} Z" fill="${color}" fill-opacity=".14"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>`;
}
function avatar(v, P, cx, cy, rad) {
  if (v.avatar) {
    return `<defs><clipPath id="av"><circle cx="${cx}" cy="${cy}" r="${rad}"/></clipPath></defs><image href="${esc(v.avatar)}" x="${cx - rad}" y="${cy - rad}" width="${rad * 2}" height="${rad * 2}" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/><circle cx="${cx}" cy="${cy}" r="${rad - 0.5}" fill="none" stroke="${P.border}"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${P.pill}" stroke="${P.border}"/>` + T(cx, cy + rad * 0.34, v.initial, P.accent, rad * 0.9, "s", ' text-anchor="middle"');
}
function profile(v, P) {
  const H = 148;
  const s = [card(P, H), avatar(v, P, 60, 74, 36)];
  const x = 116;
  const name = fit(R6, v.name, 28, 330, -0.5);
  const handle = fit(R4, `@${v.login}`, 15, 200);
  const handleX = x + measure(R6, name, 28, -0.5) + 12;
  s.push(T(x, 58, name, P.text, 28, "s", ' letter-spacing="-0.5"'));
  s.push(T(handleX, 58, handle, P.muted, 15));
  const meta = [v.location, `on GitHub since ${v.since.slice(0, 4)}`].filter(Boolean).join(" \xB7 ");
  const room = CARD_WIDTH - 24 - (handleX + measure(R4, handle, 15)) - 24;
  s.push(T(CARD_WIDTH - 24, 40, fit(R4, meta, 12.5, room), P.muted, 12.5, "r", ' text-anchor="end"'));
  const line = [v.headline, ...v.tagline.slice(0, 1)].filter(Boolean).join(" \xB7 ");
  if (line) s.push(T(x, 84, fit(R4, line, 15, CARD_WIDTH - x - 24), P.sub, 15));
  let px = x;
  for (const label of [...v.programs.slice(0, 2), ...v.website ? [v.website] : []]) {
    const text = fit(R5, label, 12.5, 260);
    const w = measure(R5, text, 12.5) + 32;
    if (px + w > CARD_WIDTH - 24) break;
    s.push(`<rect x="${r(px + 0.5)}" y="104.5" width="${r(w)}" height="25" rx="12.5" fill="${P.pill}" stroke="${P.border}"/>`);
    s.push(`<circle cx="${r(px + 13)}" cy="117" r="3" fill="${P.accent}"/>`);
    s.push(T(px + 22, 121.5, text, P.sub, 12.5, "m"));
    px += w + 8;
  }
  return doc(`${v.name} on GitHub`, H, [R4, R5, R6], s.join(""), line || void 0);
}
function stats(v, P) {
  const H = 124;
  const st = v.stats;
  const s = [card(P, H)];
  const cols = [
    ["Merged upstream", st.mergedUpstream, `into ${formatInt(st.upstreamOwners)} organizations`, v.months.map((m) => m.merged)],
    ["Stars earned", st.stars, `across ${formatInt(st.repos)} repositories`, null],
    ["Contributions", st.contributions, "last 12 months", v.weeks.map((w) => w.total)],
    ["Active days", st.activeDays, `longest streak ${formatInt(st.longestStreak)} days`, null]
  ];
  const cw = CARD_WIDTH / 4;
  cols.forEach(([label, val, ctx, series], i) => {
    const x = i * cw + 24;
    if (i) s.push(`<line x1="${r(i * cw)}" y1="20" x2="${r(i * cw)}" y2="${H - 20}" stroke="${P.border}"/>`);
    s.push(T(x, 38, label, P.muted, 13));
    const num = formatInt(val);
    s.push(T(x, 78, num, P.text, 34, "m", ' letter-spacing="-0.8"'));
    s.push(T(x, 101, fit(R4, ctx, 12, cw - 40), P.muted, 12));
    const sx = x + measure(R5, num, 34, -0.8) + 14;
    if (series && sx < x + cw - 70) s.push(spark(series, sx, 52, x + cw - 44 - sx, 30, P.accent));
  });
  return doc("GitHub stats", H, [R4, R5], s.join(""), `${st.mergedUpstream} pull requests merged upstream, ${st.stars} stars, ${st.contributions} contributions in the last year.`);
}
function activity(v, P) {
  const H = 244;
  const s = [card(P, H), heading(P, "Contributions", `${formatInt(v.stats.contributions)} in the last year`, "Weekly")];
  const vals = v.weeks.map((w) => w.total);
  const sorted = [...vals].sort((a, b) => b - a);
  const cap = Math.max(4, (sorted[1] ?? sorted[0] ?? 4) * 1.35);
  const x0 = 56;
  const y0 = 64;
  const cw = 760;
  const ch = 136;
  for (const g of [0, 0.5, 1]) {
    const gy = y0 + ch - g * ch;
    s.push(`<line x1="${x0}" y1="${r(gy + 0.5)}" x2="${x0 + cw}" y2="${r(gy + 0.5)}" stroke="${P.grid}"/>`);
    s.push(T(x0 - 10, gy + 4, String(Math.round(g * cap)), P.muted, 11, "mono", ' text-anchor="end"'));
  }
  const bw = cw / Math.max(1, vals.length);
  const peak = vals.indexOf(Math.max(...vals));
  vals.forEach((val, i) => {
    if (val === 0) return;
    const h = Math.min(val, cap) / cap * ch;
    const bx = x0 + i * bw + 1.5;
    s.push(`<rect${i === peak ? ' class="peak"' : ""} x="${r(bx)}" y="${r(y0 + ch - h)}" width="${r(bw - 3)}" height="${r(h)}" rx="2" fill="${i === peak ? P.accent : P.accent2}"/>`);
    if (val > cap) {
      s.push(`<path d="M${r(bx - 1)} ${y0 + 13} l${r(bw - 1)} -4 M${r(bx - 1)} ${y0 + 17} l${r(bw - 1)} -4" stroke="${P.card}" stroke-width="2"/>`);
      const label = `${formatInt(val)} \xB7 week of ${formatDayMonth(v.weeks[i].start)}`;
      const lw = measure(R5, label, 12);
      const lx = bx + bw + 8 + lw > x0 + cw ? bx - 8 - lw : bx + bw + 8;
      s.push(T(lx, y0 + 12, label, P.text, 12, "m"));
    }
  });
  v.weeks.forEach((w, i) => {
    if (i > 0 && w.start.slice(5, 7) !== v.weeks[i - 1].start.slice(5, 7)) s.push(T(x0 + i * bw + 1, y0 + ch + 22, shortMonth(w.start), P.muted, 11, "mono"));
  });
  if (v.stats.contributions === 0) s.push(emptyNote(P, y0 + ch / 2, "No public contributions in the last year yet."));
  return doc("Weekly contributions", H, [R4, R5, MO], s.join(""), `${v.stats.contributions} contributions in the last year.`);
}
function upstream(v, P) {
  const rows = v.upstream.slice(0, 6);
  const H = rows.length ? 86 + rows.length * 50 : 110;
  const st = v.stats;
  const s = [card(P, H), heading(P, "Merged upstream", `${formatInt(st.mergedUpstream)} pull requests into ${formatInt(st.upstreamOwners)} organizations`, rows.length ? "ranked by project and PR size" : void 0)];
  if (!rows.length) {
    s.push(emptyNote(P, 76, "No merged pull requests to other people\u2019s repositories yet."));
    return doc("Merged pull requests upstream", H, [R4, R5], s.join(""));
  }
  rows.forEach((u, i) => {
    const y = 64 + i * 50;
    s.push(`<line x1="24" y1="${y + 0.5}" x2="${CARD_WIDTH - 24}" y2="${y + 0.5}" stroke="${P.border}"/>`);
    const owner = u.owner;
    const h = hueOf(owner);
    s.push(`<rect x="24" y="${y + 11}" width="28" height="28" rx="7" fill="hsl(${h} 45% ${P.dark ? "18%" : "94%"})"/>`);
    s.push(T(38, y + 30, owner[0].toUpperCase(), `hsl(${h} 70% ${P.dark ? "72%" : "38%"})`, 13, "s", ' text-anchor="middle"'));
    const repoText = fit(R5, u.repo, 14, 420);
    const split = repoText.startsWith(`${owner}/`);
    const repoSvg = split ? `${esc(owner)}<tspan fill="${P.muted}">/</tspan>${esc(repoText.slice(owner.length + 1))}` : esc(repoText);
    s.push(`<text x="66" y="${y + 22}" class="m" font-size="14" fill="${P.text}">${repoSvg}</text>`);
    if (u.stars > 0) {
      const sx = 66 + measure(R5, repoText, 14) + 12;
      s.push(`<path d="${starPath(sx + 5, y + 17.5, 5.5, 2.4)}" fill="${P.muted}"/>`);
      s.push(T(sx + 14, y + 22, compactNumber(u.stars), P.muted, 12.5));
    }
    s.push(T(66, y + 40, fit(R4, u.latest.title, 12.5, 560), P.muted, 12.5));
    s.push(T(CARD_WIDTH - 24, y + 22, formatDate(u.latest.mergedAt), P.muted, 12.5, "r", ' text-anchor="end"'));
    if (u.merged > 1) {
      const label = `${u.merged} merged`;
      const w = measure(R5, label, 11.5) + 16;
      s.push(`<rect x="${r(CARD_WIDTH - 24 - w)}" y="${y + 29}" width="${r(w)}" height="18" rx="9" fill="${P.track}"/>`);
      s.push(T(CARD_WIDTH - 24 - w / 2, y + 41.5, label, P.sub, 11.5, "m", ' text-anchor="middle"'));
    }
  });
  return doc("Merged pull requests upstream", H, [R4, R5, R6], s.join(""), `${st.mergedUpstream} pull requests merged into ${st.upstreamRepos} repositories owned by others.`);
}
function languages(v, P) {
  const H = 96;
  const s = [card(P, H), T(24, 36, "Languages", P.text, 15, "m"), T(CARD_WIDTH - 24, 36, "by code size", P.muted, 12.5, "r", ' text-anchor="end"')];
  const langs = v.languages;
  if (!langs.length) {
    s.push(emptyNote(P, 66, "No language data yet."));
    return doc("Languages", H, [R4, R5], s.join(""));
  }
  const ramp = [1, 0.78, 0.6, 0.46, 0.35, 0.27, 0.2];
  let bx = 24;
  langs.forEach((l, i) => {
    const w = l.share * (CARD_WIDTH - 48);
    if (w >= 1) s.push(`<rect x="${r(bx)}" y="50" width="${r(Math.max(1, w - 2))}" height="8" rx="2" fill="${P.accent}" fill-opacity="${ramp[i] ?? 0.2}"/>`);
    bx += w;
  });
  let lx = 24;
  langs.forEach((l, i) => {
    const pct = `${(l.share * 100).toFixed(l.share < 0.1 ? 1 : 0)}%`;
    const w = measure(R4, `${l.name} ${pct}`, 12.5) + 34;
    if (lx + w > CARD_WIDTH - 16) return;
    s.push(`<circle cx="${r(lx + 4)}" cy="77" r="4" fill="${P.accent}" fill-opacity="${ramp[i] ?? 0.2}"/>`);
    s.push(`<text x="${r(lx + 13)}" y="81" class="r" font-size="12.5" fill="${P.sub}">${esc(l.name)} <tspan fill="${P.muted}">${pct}</tspan></text>`);
    lx += w;
  });
  return doc("Languages", H, [R4, R5], s.join(""), langs.map((l) => `${l.name} ${(l.share * 100).toFixed(0)}%`).join(", "));
}
function forkIcon(x, y, c) {
  return `<g fill="none" stroke="${c}" stroke-width="1.3"><circle cx="${x}" cy="${y - 8}" r="1.8"/><circle cx="${x + 8}" cy="${y - 8}" r="1.8"/><circle cx="${x + 4}" cy="${y + 1}" r="1.8"/><path d="M${x} ${y - 6} v1.5 a2 2 0 0 0 2 2 h4 a2 2 0 0 0 2 -2 v-1.5 M${x + 4} ${y - 2.5} v1.7"/></g>`;
}
function repos(v, P) {
  const items = v.repos;
  const rowsN = Math.ceil(items.length / 3);
  const H = items.length ? 60 + rowsN * 124 : 110;
  const s = [card(P, H), heading(P, "Repositories", "most starred")];
  if (!items.length) {
    s.push(emptyNote(P, 76, "No public repositories yet."));
    return doc("Repositories", H, [R4, R5], s.join(""));
  }
  const gw = (CARD_WIDTH - 48 - 24) / 3;
  items.forEach((rp, i) => {
    const x = 24 + i % 3 * (gw + 12);
    const y = 60 + Math.floor(i / 3) * 124;
    s.push(`<rect x="${r(x + 0.5)}" y="${y + 0.5}" width="${r(gw - 1)}" height="111" rx="10" fill="${P.pill}" stroke="${P.border}"/>`);
    s.push(T(x + 16, y + 28, fit(R5, rp.name, 14, gw - 32), P.text, 14, "m"));
    wrap(R4, rp.description ?? "No description", 12.5, gw - 32, 2).forEach((line, k) => s.push(T(x + 16, y + 50 + k * 18, line, P.muted, 12.5)));
    let fx = x + 16;
    if (rp.language) {
      s.push(`<circle cx="${r(fx + 4)}" cy="${y + 94}" r="4" fill="${rp.languageColor ?? P.accent}"/>`);
      const lang = fit(R4, rp.language, 12, gw / 2 - 30);
      s.push(T(fx + 13, y + 98, lang, P.sub, 12));
      fx += measure(R4, lang, 12) + 28;
    }
    s.push(`<path d="${starPath(fx + 5, y + 93.5, 5.5, 2.4)}" fill="${P.muted}"/>`);
    s.push(T(fx + 14, y + 98, formatInt(rp.stars), P.sub, 12, "m"));
    fx += measure(R5, formatInt(rp.stars), 12) + 30;
    s.push(forkIcon(fx, y + 98, P.muted));
    s.push(T(fx + 14, y + 98, formatInt(rp.forks), P.sub, 12, "m"));
  });
  return doc("Top repositories", H, [R4, R5], s.join(""), items.map((rp) => `${rp.name}, ${rp.stars} stars`).join("; "));
}
function writing(v, P) {
  const posts = v.posts;
  const H = posts.length ? 64 + posts.length * 44 + 12 : 110;
  const s = [card(P, H), heading(P, "Writing", v.blogHost ?? "latest posts")];
  if (!posts.length) {
    s.push(emptyNote(P, 76, "Add your blog\u2019s RSS feed with the blog input to list posts here."));
    return doc("Writing", H, [R4, R5], s.join(""));
  }
  posts.forEach((p, i) => {
    const y = 64 + i * 44;
    s.push(`<line x1="24" y1="${y + 0.5}" x2="${CARD_WIDTH - 24}" y2="${y + 0.5}" stroke="${P.border}"/>`);
    s.push(T(24, y + 28, fit(R5, p.title, 14.5, CARD_WIDTH - 24 - 160), P.text, 14.5, "m"));
    s.push(T(CARD_WIDTH - 48, y + 28, p.date ? formatDate(p.date) : "", P.muted, 12.5, "r", ' text-anchor="end"'));
    s.push(`<path d="M${CARD_WIDTH - 34} ${y + 27} l6 -6 M${CARD_WIDTH - 33} ${y + 21} h5 v5" fill="none" stroke="${P.muted}" stroke-width="1.4" stroke-linecap="round"/>`);
  });
  return doc("Writing", H, [R4, R5], s.join(""), posts.map((p) => p.title).join("; "));
}
var CARDS = { profile, stats, activity, upstream, languages, repos, writing };
var clean = {
  id: "clean",
  name: "Clean product UI",
  description: "Analytics-page precision: Geist type, hairline borders, one accent color.",
  render: (card2, view, scheme) => CARDS[card2](view, PAL[scheme])
};

// ../core/src/looks/ops.ts
var PAL2 = {
  dark: {
    canvas: "#111217",
    panel: "#181b1f",
    border: "#272b31",
    text: "#d8d9dc",
    muted: "#8f939b",
    grid: "#23272d",
    track: "#21252b",
    chip: "#1f2328",
    green: "#6ccf8e",
    yellow: "#f2c94c",
    blue: "#6aa8ff",
    purple: "#c291ff",
    orange: "#ff9d5c",
    red: "#ff7a85"
  },
  light: {
    canvas: "#f3f4f6",
    panel: "#ffffff",
    border: "#dde1e6",
    text: "#1f2328",
    muted: "#636b78",
    grid: "#eef0f3",
    track: "#eceff2",
    chip: "#f6f7f9",
    green: "#1e9a57",
    yellow: "#a87b12",
    blue: "#2f6fdb",
    purple: "#8250df",
    orange: "#c8651b",
    red: "#cf3c49"
  }
};
var R42 = "sans-400";
var R52 = "sans-500";
var R62 = "sans-600";
var BIG = "cond-600";
var MO2 = "code-400";
var CSS2 = `.r{font-family:${STACK.sans};font-weight:400}.m{font-family:${STACK.sans};font-weight:500}.s{font-family:${STACK.sans};font-weight:600}.big{font-family:${STACK.cond};font-weight:600;font-feature-settings:'tnum'}.mono{font-family:${STACK.code};font-weight:400}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}.live{animation:pulse 2s ease-in-out infinite}` + REDUCED_MOTION(".live");
function T2(x, y, text, fill, size, cls = "r", extra = "") {
  return `<text x="${r(x)}" y="${r(y)}" class="${cls}" font-size="${size}" fill="${fill}"${extra}>${esc(text)}</text>`;
}
function canvas(P, h) {
  return `<rect width="${CARD_WIDTH}" height="${h}" rx="6" fill="${P.canvas}"/>`;
}
function panel(P, x, y, w, h, title, right) {
  const s = [
    `<rect x="${r(x + 0.5)}" y="${r(y + 0.5)}" width="${r(w - 1)}" height="${r(h - 1)}" rx="4" fill="${P.panel}" stroke="${P.border}"/>`,
    T2(x + 12, y + 22, fit(R52, title, 12.5, w * 0.55), P.text, 12.5, "m")
  ];
  if (right) s.push(T2(x + w - 12, y + 22, fit(R42, right, 11.5, w * 0.42), P.muted, 11.5, "r", ' text-anchor="end"'));
  return s.join("");
}
function area(values, x, y, w, h, color) {
  if (values.length < 2 || Math.max(...values) === 0) return "";
  const mx = Math.max(...values);
  const pts = values.map((v, i) => [x + i * w / (values.length - 1), y + h - v / mx * h * 0.9]);
  const line = linePath(pts);
  return `<path d="${line} L${r(x + w)} ${r(y + h)} L${r(x)} ${r(y + h)} Z" fill="${color}" fill-opacity=".16"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.4"/><circle class="live" cx="${r(pts.at(-1)[0])}" cy="${r(pts.at(-1)[1])}" r="2.6" fill="${color}"/>`;
}
function empty(P, x, y, text) {
  return T2(x, y, text, P.muted, 12.5);
}
function doc2(title, h, fonts, body, desc) {
  return svgDoc({ width: CARD_WIDTH, height: h, title, ...desc ? { desc } : {}, fonts, css: CSS2, body });
}
function profile2(v, P) {
  const H = 226;
  const s = [canvas(P, H)];
  for (let i = 0; i < 4; i++) s.push(`<rect x="${14 + i % 2 * 7}" y="${15 + Math.floor(i / 2) * 7}" width="5" height="5" rx="1" fill="${P.muted}"/>`);
  s.push(`<text x="38" y="25" class="r" font-size="13" fill="${P.muted}">${esc(fit(R42, v.login, 13, 300))} / <tspan class="s" fill="${P.text}">Profile</tspan></text>`);
  let cx = CARD_WIDTH - 12;
  for (const [label, value] of [["Refresh", "6h"], ["Range", "Last 12 months"]]) {
    const w = measure(R52, value, 12) + measure(R42, label, 12) + 26;
    cx -= w;
    s.push(`<rect x="${r(cx + 0.5)}" y="8.5" width="${r(w)}" height="24" rx="4" fill="${P.chip}" stroke="${P.border}"/>`);
    s.push(`<text x="${r(cx + 9)}" y="25" class="r" font-size="12" fill="${P.muted}">${label} <tspan class="m" fill="${P.text}">${value}</tspan></text>`);
    cx -= 8;
  }
  s.push(`<circle class="live" cx="${r(cx - 8)}" cy="20.5" r="3.5" fill="${P.green}"/>`);
  const y = 44;
  const lw = 470;
  s.push(panel(P, 12, y, lw, H - y - 12, "About"));
  s.push(T2(26, y + 62, fit(R62, v.name, 26, lw - 40), P.text, 26, "s", ' letter-spacing="-0.4"'));
  if (v.headline) s.push(T2(26, y + 88, fit(R42, v.headline, 14, lw - 40), P.text, 14));
  v.tagline.slice(0, 2).forEach((t, i) => s.push(T2(26, y + 112 + i * 20, fit(R42, t, 13, lw - 40), P.muted, 13)));
  const tx = 12 + lw + 8;
  const tw = CARD_WIDTH - 12 - tx;
  s.push(panel(P, tx, y, tw, H - y - 12, "Details", "table"));
  const rows = [];
  if (v.location) rows.push(["Location", v.location, P.text]);
  rows.push(["On GitHub since", formatDate(v.since), P.text]);
  v.programs.slice(0, 2).forEach((p) => rows.push(["Program", p, P.text]));
  if (v.website) rows.push(["Web", v.website, P.blue]);
  rows.push(["Followers", formatInt(v.followers), P.text]);
  rows.slice(0, 5).forEach(([k, val, tone], i) => {
    const ry = y + 34 + i * 26;
    s.push(`<line x1="${tx + 1}" y1="${r(ry + 0.5)}" x2="${tx + tw - 1}" y2="${r(ry + 0.5)}" stroke="${P.grid}"/>`);
    s.push(T2(tx + 12, ry + 18, k, P.muted, 12.5));
    s.push(T2(tx + tw - 12, ry + 18, fit(R42, val, 12.5, tw - 140), tone, 12.5, "r", ' text-anchor="end"'));
  });
  return doc2(`${v.name} on GitHub`, H, [R42, R52, R62], s.join(""), [v.headline, ...v.tagline].filter(Boolean).join(". "));
}
function stats2(v, P) {
  const H = 164;
  const st = v.stats;
  const s = [canvas(P, H)];
  const items = [
    ["Merged upstream", st.mergedUpstream, P.green, v.months.map((m) => m.merged), `${formatInt(st.upstreamOwners)} orgs`],
    ["Stars earned", st.stars, P.yellow, null, `${formatInt(st.repos)} repos`],
    ["Contributions", st.contributions, P.blue, v.weeks.map((w) => w.total), "12 mo"],
    ["Active days", st.activeDays, P.purple, v.months.map((m) => m.activeDays), `streak ${formatInt(st.longestStreak)}d`]
  ];
  const pw = (CARD_WIDTH - 24 - 3 * 8) / 4;
  items.forEach(([title, val, color, series, unit], i) => {
    const x = 12 + i * (pw + 8);
    const y = 12;
    s.push(panel(P, x, y, pw, 140, title, unit));
    if (series) s.push(area(series, x + 1, y + 92, pw - 2, 47, color));
    else {
      const top = v.repos.slice(0, 6);
      const mx = Math.max(1, ...top.map((rp) => rp.stars));
      const bw = (pw - 24) / Math.max(1, top.length);
      top.forEach((rp, k) => {
        const h = Math.max(2, rp.stars / mx * 38);
        s.push(`<rect x="${r(x + 12 + k * bw)}" y="${r(y + 130 - h)}" width="${r(bw - 6)}" height="${r(h)}" rx="1" fill="${color}" fill-opacity=".35"/>`);
      });
    }
    s.push(T2(x + 12, y + 84, formatInt(val), color, 50, "big"));
  });
  return doc2("GitHub stats", H, [R42, R52, BIG], s.join(""), `${st.mergedUpstream} pull requests merged upstream, ${st.stars} stars, ${st.contributions} contributions in the last year.`);
}
function activity2(v, P) {
  const H = 300;
  const s = [canvas(P, H)];
  const weeks = v.weeks;
  s.push(panel(P, 12, 8, CARD_WIDTH - 24, 162, "Contributions per week", `${formatInt(v.stats.contributions)} in 12 months`));
  const vals = weeks.map((w) => w.total);
  const mx = Math.max(4, ...vals);
  const x0 = 52;
  const x1 = CARD_WIDTH - 26;
  const y0 = 44;
  const ch = 96;
  for (const g of [0, 0.5, 1]) {
    const gy = y0 + ch - g * ch;
    s.push(`<line x1="${x0}" y1="${r(gy + 0.5)}" x2="${x1}" y2="${r(gy + 0.5)}" stroke="${P.grid}"/>`);
    s.push(T2(x0 - 8, gy + 4, String(Math.round(g * mx)), P.muted, 10.5, "mono", ' text-anchor="end"'));
  }
  const pts = vals.map((val, i) => [x0 + i * (x1 - x0) / Math.max(1, vals.length - 1), y0 + ch - val / mx * ch]);
  if (pts.length > 1) {
    const line = linePath(pts);
    s.push(`<path d="${line} L${x1} ${y0 + ch} L${x0} ${y0 + ch} Z" fill="${P.blue}" fill-opacity=".14"/><path d="${line}" fill="none" stroke="${P.blue}" stroke-width="1.5" stroke-linejoin="round"/><circle class="live" cx="${r(pts.at(-1)[0])}" cy="${r(pts.at(-1)[1])}" r="3" fill="${P.blue}"/>`);
  }
  weeks.forEach((w, i) => {
    if (i > 0 && w.start.slice(5, 7) !== weeks[i - 1].start.slice(5, 7)) s.push(T2(pts[i][0], y0 + ch + 16, shortMonth(w.start), P.muted, 10.5, "mono", ' text-anchor="middle"'));
  });
  const active = weeks.filter((w) => w.total > 0).length;
  const pct = weeks.length ? active / weeks.length * 100 : 0;
  s.push(panel(P, 12, 178, CARD_WIDTH - 24, H - 178 - 8, "Contribution uptime", `${active} of ${weeks.length} weeks active \xB7 ${pct.toFixed(1)}%`));
  const ux0 = 26;
  const ux1 = CARD_WIDTH - 26;
  const cw = (ux1 - ux0) / Math.max(1, weeks.length);
  weeks.forEach((w, i) => {
    const op = w.total === 0 ? 1 : w.total < 3 ? 0.45 : w.total < 10 ? 0.7 : 1;
    s.push(`<rect x="${r(ux0 + i * cw + 1)}" y="212" width="${r(cw - 2)}" height="34" rx="2" fill="${w.total === 0 ? P.track : P.green}" fill-opacity="${op}"/>`);
  });
  s.push(T2(ux0, 266, "52 weeks ago", P.muted, 10.5, "mono"));
  s.push(T2(ux1, 266, "this week", P.muted, 10.5, "mono", ' text-anchor="end"'));
  s.push(`<line x1="${ux0 + 92}" y1="262.5" x2="${ux1 - 70}" y2="262.5" stroke="${P.border}"/>`);
  return doc2("Contribution activity", H, [R42, R52, MO2], s.join(""), `${v.stats.contributions} contributions; active in ${active} of ${weeks.length} weeks.`);
}
function upstream2(v, P) {
  const rows = v.timeline.rows;
  const months = v.timeline.months;
  const table = v.upstream.slice(0, 5);
  const th = rows.length ? 58 + rows.length * 30 + 26 : 76;
  const tb = table.length ? 48 + table.length * 28 + 8 : 0;
  const H = 8 + th + (tb ? 8 + tb : 0) + 8;
  const st = v.stats;
  const s = [canvas(P, H)];
  s.push(panel(P, 12, 8, CARD_WIDTH - 24, th, "Upstream merges", "state timeline \xB7 merged PRs per month"));
  if (!rows.length) {
    s.push(empty(P, 26, 60, v.upstream.length ? "No merges in the last 12 months." : "No merged pull requests to other people\u2019s repositories yet."));
  } else {
    const colors = [P.green, P.blue, P.purple, P.orange, P.yellow, P.red];
    const x0 = 214;
    const x1 = CARD_WIDTH - 28;
    const cw = (x1 - x0) / 12;
    rows.forEach((row, i) => {
      const y = 44 + i * 30;
      s.push(T2(26, y + 16, fit(R42, row.label, 12.5, 176), P.text, 12.5));
      s.push(`<rect x="${x0}" y="${y + 3}" width="${r(x1 - x0)}" height="20" rx="2" fill="${P.track}"/>`);
      row.counts.forEach((n, j) => {
        if (!n) return;
        s.push(`<rect x="${r(x0 + j * cw + 1)}" y="${y + 3}" width="${r(cw - 2)}" height="20" rx="2" fill="${colors[i % colors.length]}" fill-opacity=".92"/>`);
        s.push(T2(x0 + j * cw + cw / 2, y + 17.5, String(n), P.panel, 11.5, "s", ' text-anchor="middle"'));
      });
    });
    const ly = 44 + rows.length * 30 + 12;
    months.forEach((m, j) => s.push(T2(x0 + j * cw + cw / 2, ly, shortMonth(m), P.muted, 10.5, "mono", ' text-anchor="middle"')));
  }
  if (tb) {
    const ty = 8 + th + 8;
    s.push(panel(P, 12, ty, CARD_WIDTH - 24, tb, "Top upstream repositories", `${formatInt(st.mergedUpstream)} merged \xB7 ${formatInt(st.upstreamOwners)} orgs`));
    const cols = [["Repository", 26, ""], ["Stars", 520, ' text-anchor="end"'], ["Merged", 600, ' text-anchor="end"'], ["Latest merge", CARD_WIDTH - 26, ' text-anchor="end"']];
    cols.forEach(([label, x, a]) => s.push(T2(x, ty + 42, label, P.muted, 11, "m", a)));
    table.forEach((u, i) => {
      const y = ty + 50 + i * 28;
      s.push(`<line x1="13" y1="${r(y + 0.5)}" x2="${CARD_WIDTH - 13}" y2="${r(y + 0.5)}" stroke="${P.grid}"/>`);
      s.push(T2(26, y + 19, fit(R42, u.repo, 12.5, 380), P.blue, 12.5));
      s.push(T2(520, y + 19, compactNumber(u.stars), P.text, 15, "big", ' text-anchor="end"'));
      s.push(T2(600, y + 19, formatInt(u.merged), P.text, 15, "big", ' text-anchor="end"'));
      s.push(T2(CARD_WIDTH - 26, y + 19, formatDate(u.latest.mergedAt), P.muted, 12.5, "r", ' text-anchor="end"'));
    });
  }
  return doc2("Merged pull requests upstream", H, [R42, R52, R62, BIG, MO2], s.join(""), `${st.mergedUpstream} pull requests merged into ${st.upstreamRepos} repositories owned by others.`);
}
function languages2(v, P) {
  const langs = v.languages;
  const H = langs.length ? 52 + langs.length * 26 + 20 : 90;
  const s = [canvas(P, H), panel(P, 12, 8, CARD_WIDTH - 24, H - 16, "Languages", "bar gauge \xB7 share of code")];
  if (!langs.length) {
    s.push(empty(P, 26, 58, "No language data yet."));
    return doc2("Languages", H, [R42, R52], s.join(""));
  }
  const top = Math.max(...langs.map((l) => l.share));
  const n = 72;
  const seg = 6;
  langs.forEach((l, i) => {
    const y = 42 + i * 26;
    s.push(T2(26, y + 12, fit(R42, l.name, 12.5, 130), l.name === "Other" ? P.muted : P.text, 12.5));
    const lit = Math.max(1, Math.round(l.share / top * n));
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const col = t < 0.6 ? P.green : t < 0.85 ? P.yellow : P.orange;
      s.push(`<rect x="${166 + k * (seg + 2)}" y="${y}" width="${seg}" height="16" rx="1" fill="${k < lit ? col : P.track}"/>`);
    }
    s.push(T2(CARD_WIDTH - 26, y + 13, `${(l.share * 100).toFixed(l.share < 0.1 ? 1 : 0)}%`, P.text, 16, "big", ' text-anchor="end"'));
  });
  return doc2("Languages", H, [R42, R52, BIG], s.join(""), langs.map((l) => `${l.name} ${(l.share * 100).toFixed(0)}%`).join(", "));
}
function repos2(v, P) {
  const items = v.repos;
  const H = items.length ? 58 + items.length * 30 + 16 : 90;
  const s = [canvas(P, H), panel(P, 12, 8, CARD_WIDTH - 24, H - 16, "Top repositories", "table")];
  if (!items.length) {
    s.push(empty(P, 26, 58, "No public repositories yet."));
    return doc2("Repositories", H, [R42, R52], s.join(""));
  }
  const cols = [["Name", 26, ""], ["Language", 340, ""], ["Stars", 600, ' text-anchor="end"'], ["Forks", 680, ' text-anchor="end"'], ["Updated", CARD_WIDTH - 26, ' text-anchor="end"']];
  cols.forEach(([label, x, a]) => s.push(T2(x, 50, label, P.muted, 11, "m", a)));
  const mx = Math.max(1, ...items.map((rp) => rp.stars));
  items.forEach((rp, i) => {
    const y = 58 + i * 30;
    s.push(`<line x1="13" y1="${r(y + 0.5)}" x2="${CARD_WIDTH - 13}" y2="${r(y + 0.5)}" stroke="${P.grid}"/>`);
    s.push(T2(26, y + 20, fit(R42, rp.name, 12.5, 290), P.blue, 12.5));
    s.push(T2(340, y + 20, fit(R42, rp.language ?? "", 12.5, 120), P.muted, 12.5));
    s.push(`<rect x="470" y="${y + 9}" width="${r(Math.max(2, rp.stars / mx * 90))}" height="12" rx="1" fill="${P.yellow}" fill-opacity=".85"/>`);
    s.push(T2(600, y + 20, formatInt(rp.stars), P.text, 15, "big", ' text-anchor="end"'));
    s.push(T2(680, y + 20, formatInt(rp.forks), P.muted, 15, "big", ' text-anchor="end"'));
    s.push(T2(CARD_WIDTH - 26, y + 20, rp.pushedAt ? formatDate(rp.pushedAt.slice(0, 7)) : "", P.muted, 12.5, "r", ' text-anchor="end"'));
  });
  return doc2("Top repositories", H, [R42, R52, BIG], s.join(""), items.map((rp) => `${rp.name}, ${rp.stars} stars`).join("; "));
}
function writing2(v, P) {
  const posts = v.posts;
  const H = posts.length ? 48 + posts.length * 28 + 16 : 90;
  const s = [canvas(P, H), panel(P, 12, 8, CARD_WIDTH - 24, H - 16, "Logs", posts.length ? `${v.blogHost ?? "blog"} \xB7 ${posts.length} lines` : "blog")];
  if (!posts.length) {
    s.push(empty(P, 26, 58, "Add your blog\u2019s RSS feed with the blog input to stream posts here."));
    return doc2("Writing", H, [R42, R52], s.join(""));
  }
  posts.forEach((p, i) => {
    const y = 42 + i * 28;
    s.push(`<rect x="13" y="${y}" width="3" height="20" fill="${P.blue}"/>`);
    s.push(T2(26, y + 14, p.date ?? "", P.muted, 12, "mono"));
    s.push(`<rect x="118" y="${y + 2}" width="38" height="16" rx="3" fill="${P.blue}" fill-opacity=".16"/>`);
    s.push(T2(137, y + 14, "post", P.blue, 11, "mono", ' text-anchor="middle"'));
    s.push(T2(168, y + 14, fit(R42, p.title, 13, CARD_WIDTH - 168 - 26), P.text, 13));
  });
  return doc2("Writing", H, [R42, R52, MO2], s.join(""), posts.map((p) => p.title).join("; "));
}
var CARDS2 = { profile: profile2, stats: stats2, activity: activity2, upstream: upstream2, languages: languages2, repos: repos2, writing: writing2 };
var ops = {
  id: "ops",
  name: "Ops dashboard",
  description: "Your profile as an observability dashboard: stat panels, a state timeline, bar gauges.",
  render: (card2, view, scheme) => CARDS2[card2](view, PAL2[scheme])
};

// ../core/src/looks/playful.ts
var C = {
  cobalt: "#2e55ff",
  tangerine: "#ff6a2b",
  pink: "#ff8ccf",
  sun: "#ffd23f",
  grape: "#7b5cff",
  mint: "#3ddc97",
  ink: "#141217",
  cream: "#fff7ea"
};
var R53 = "display-500";
var X8 = "display-800";
var CSS3 = `.r{font-family:${STACK.display};font-weight:500}.x{font-family:${STACK.display};font-weight:800}@keyframes pop{from{transform:translateY(8px) scale(.985)}to{transform:none}}.tile{transform-box:fill-box;transform-origin:center;animation:pop .6s cubic-bezier(.2,.9,.25,1.2) both}@keyframes spin{to{transform:rotate(360deg)}}` + REDUCED_MOTION(".tile,.spin");
function T3(x, y, text, fill, size, cls = "r", extra = "") {
  return `<text x="${r(x)}" y="${r(y)}" class="${cls}" font-size="${size}" fill="${fill}"${extra}>${esc(text)}</text>`;
}
function tile(x, y, w, h, fill, delay = 0) {
  return `<g class="tile" style="animation-delay:${delay}s"><rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="28" fill="${fill}"/>`;
}
function big(x, y, text, fill, max, width, min = 18, tracking = -0.03) {
  let size = max;
  while (size > min && measure(X8, text, size, size * tracking) > width) size -= 1;
  return T3(x, y, fit(X8, text, size, width, size * tracking), fill, size, "x", ` letter-spacing="${r(size * tracking)}"`);
}
function doc3(title, h, body, desc) {
  return svgDoc({ width: CARD_WIDTH, height: h, title, ...desc ? { desc } : {}, fonts: [R53, X8], css: CSS3, body });
}
function pill(x, y, text, bg, fg, size = 15, rot = 0) {
  const w = measure(R53, text, size) + size * 2;
  const h = size * 2.4;
  const g = rot ? ` transform="rotate(${rot} ${r(x + w / 2)} ${r(y + h / 2)})"` : "";
  return {
    svg: `<g${g}><rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="${r(h / 2)}" fill="${bg}"/>${T3(x + size, y + h / 2 + size * 0.36, text, fg, size)}</g>`,
    w
  };
}
function profile3(v) {
  const H = 250;
  const s = [tile(0, 0, CARD_WIDTH, H, C.cobalt)];
  const hi = `Hi, I\u2019m ${v.name}.`;
  s.push(big(40, 104, hi, C.cream, 68, 560, 30));
  if (v.headline) s.push(T3(42, 150, fit(R53, v.headline, 22, 560), C.cream, 22, "r", ' fill-opacity=".92"'));
  let x = 42;
  const chips = [];
  v.programs.slice(0, 2).forEach((p, i) => chips.push([p, i === 0 ? C.sun : C.pink, C.ink]));
  if (v.website) chips.push([v.website, C.ink, C.cream]);
  for (const [text, bg, fg] of chips) {
    const label = fit(R53, text, 15, 240);
    const p = pill(x, 176, label, bg, fg, 15);
    if (x + p.w > 600) break;
    s.push(p.svg);
    x += p.w + 10;
  }
  s.push("</g>");
  const cx = 718;
  const cy = 118;
  const words = (v.focus.length ? v.focus.slice(0, 4) : ["open source", "github"]).map((t) => t.replace(/-/g, " ").toUpperCase());
  const circumference = 2 * Math.PI * 52 - 3;
  let ring = "";
  for (let i = 0; i < 24; i++) {
    const next = `${ring}${words[i % words.length]} \u2022 `;
    if (measure(X8, next, 14.5, 2.2) > circumference) break;
    ring = next;
  }
  if (!ring) ring = words[0].slice(0, 18) + " \u2022 ";
  const spacing = Math.min(8, Math.max(2.2, (circumference - measure(X8, ring, 14.5)) / [...ring].length));
  s.push(`<g transform="rotate(-10 ${cx} ${cy})"><circle cx="${cx}" cy="${cy}" r="74" fill="${C.sun}"/>`);
  s.push(`<defs><path id="ring" d="M${cx - 52},${cy} a52,52 0 1,1 104,0 a52,52 0 1,1 -104,0"/></defs>`);
  s.push(`<g class="spin" style="transform-box:view-box;transform-origin:${cx}px ${cy}px;animation:spin 24s linear infinite"><text class="x" font-size="14.5" fill="${C.ink}" letter-spacing="${r(spacing)}"><textPath href="#ring">${esc(ring)}</textPath></text></g>`);
  s.push(`<path d="${starPath(cx, cy, 30, 13, 8)}" fill="${C.tangerine}"/></g>`);
  return doc3(`${v.name} on GitHub`, H, s.join(""), [v.headline, ...v.programs].filter(Boolean).join(". "));
}
function stats3(v) {
  const H = 300;
  const st = v.stats;
  const gap = 12;
  const s = [];
  s.push(tile(0, 0, 352, H, C.tangerine));
  s.push(big(30, 150, formatInt(st.mergedUpstream), C.ink, 150, 300, 60, -0.04));
  const caption = st.mergedUpstream === 1 ? "pull request merged into someone else\u2019s project" : "pull requests merged into other people\u2019s projects";
  wrap(R53, caption, 23, 290, 3).forEach((line, i) => s.push(T3(32, 206 + i * 29, line, C.ink, 23)));
  s.push("</g>");
  const x2 = 352 + gap;
  const w2 = CARD_WIDTH - x2;
  s.push(tile(x2, 0, w2, 144, C.pink, 0.08));
  const stars = formatInt(st.stars);
  s.push(T3(x2 + 28, 96, stars, C.ink, 84, "x", ' letter-spacing="-3"'));
  const nx = x2 + 28 + measure(X8, stars, 84, -3) + 18;
  s.push(`<path d="${starPath(nx + 20, 64, 22, 10)}" fill="${C.ink}"/>`);
  s.push(T3(nx + 56, 62, "stars across", C.ink, 19));
  s.push(T3(nx + 56, 86, `${formatInt(st.repos)} repos`, C.ink, 19));
  s.push("</g>");
  const w3 = (w2 - gap) / 2;
  s.push(tile(x2, 144 + gap, w3, H - 144 - gap, C.sun, 0.16));
  s.push(big(x2 + 26, 144 + gap + 76, formatInt(st.contributions), C.ink, 64, w3 - 52, 30, -0.04));
  s.push(T3(x2 + 28, 144 + gap + 112, "contributions this year", C.ink, 17));
  s.push("</g>");
  const x4 = x2 + w3 + gap;
  const lang = v.languages[0]?.name ?? "Code";
  s.push(tile(x4, 144 + gap, w3, H - 144 - gap, C.mint, 0.24));
  s.push(big(x4 + 26, 144 + gap + 64, lang, C.ink, 44, w3 - 52, 20, -0.02));
  const langNote = v.languages[0] ? `#1 language, ${Math.round(v.languages[0].share * 100)}%` : "no language data yet";
  s.push(T3(x4 + 28, 144 + gap + 112, fit(R53, langNote, 17, w3 - 54), C.ink, 17));
  s.push("</g>");
  return doc3("Year in numbers", H, s.join(""), `${st.mergedUpstream} pull requests merged upstream, ${st.stars} stars, ${st.contributions} contributions this year.`);
}
function activity3(v) {
  const H = 260;
  const s = [tile(0, 0, CARD_WIDTH, H, C.sun)];
  const active = formatInt(v.stats.activeDays);
  s.push(big(34, 132, active, C.ink, 120, 260, 50, -0.04));
  s.push(T3(38, 172, v.stats.activeDays === 1 ? "day with a contribution" : "days with a contribution", C.ink, 21));
  s.push(T3(38, 200, "in the last 12 months", C.ink, 21, "r", ' fill-opacity=".7"'));
  const months = v.months;
  const mx = Math.max(1, ...months.map((m) => m.total));
  const peak = months.findIndex((m) => m.total === mx && mx > 0);
  const x0 = 330;
  const bw = (CARD_WIDTH - 40 - x0) / 12;
  months.forEach((m, i) => {
    const h = m.total ? Math.max(14, m.total / mx * 150) : 8;
    const x = x0 + i * bw + 4;
    s.push(`<rect x="${r(x)}" y="${r(196 - h)}" width="${r(bw - 8)}" height="${r(h)}" rx="${r(Math.min(12, (bw - 8) / 2))}" fill="${i === peak ? C.tangerine : C.ink}"/>`);
    s.push(T3(x + (bw - 8) / 2, 226, shortMonth(m.key).slice(0, 1), C.ink, 15, "x", ' text-anchor="middle"'));
  });
  if (peak >= 0) {
    const px = x0 + peak * bw + 4 + (bw - 8) / 2;
    const label = `${shortMonth(months[peak].key)}: ${formatInt(mx)}`;
    const lw = measure(R53, label, 14) + 24;
    const lx = Math.min(CARD_WIDTH - 30 - lw, Math.max(x0, px - lw / 2));
    s.push(`<rect x="${r(lx)}" y="16" width="${r(lw)}" height="28" rx="14" fill="${C.ink}"/>`);
    s.push(T3(lx + 12, 35, label, C.cream, 14));
  }
  s.push("</g>");
  return doc3("Contribution activity", H, s.join(""), `${v.stats.activeDays} active days and ${v.stats.contributions} contributions in the last 12 months.`);
}
function upstream3(v) {
  const owners = /* @__PURE__ */ new Map();
  for (const u of v.upstream) {
    const cur = owners.get(u.owner.toLowerCase()) ?? { label: u.owner, merged: 0, stars: 0 };
    cur.merged += u.merged;
    cur.stars = Math.max(cur.stars, u.stars);
    owners.set(u.owner.toLowerCase(), cur);
  }
  const list = [...owners.values()].sort((a, b) => b.stars - a.stars || b.merged - a.merged).slice(0, 12);
  const fills = [[C.sun, C.ink], [C.cream, C.ink], [C.mint, C.ink], [C.pink, C.ink], [C.tangerine, C.ink], [C.ink, C.cream]];
  const rot = [-3, 2, -1.5, 3, -2, 1, -2.5, 2.5, -1, 1.5, -3, 2, -1, 2];
  const placed = [];
  let x = 34;
  let y = 92;
  list.forEach((o, i) => {
    const text = o.merged > 1 ? `${o.label} \xD7${o.merged}` : o.label;
    const [bg, fg] = fills[i % fills.length];
    const p = pill(0, 0, fit(R53, text, 19, 300), bg, fg, 19);
    if (x + p.w > CARD_WIDTH - 30) {
      x = 34;
      y += 54;
    }
    placed.push(pill(x, y, fit(R53, text, 19, 300), bg, fg, 19, rot[i % rot.length]).svg);
    x += p.w + 12;
  });
  const H = list.length ? y + 46 + 26 : 150;
  const s = [tile(0, 0, CARD_WIDTH, H, C.grape)];
  s.push(T3(34, 62, list.length ? "My PRs landed in" : "My first upstream PR is coming", C.cream, 34, "x", ' letter-spacing="-1"'));
  if (list.length) s.push(T3(CARD_WIDTH - 34, 60, `${formatInt(v.stats.mergedUpstream)} merged`, C.cream, 18, "r", ' text-anchor="end" fill-opacity=".85"'));
  else s.push(T3(36, 108, "Merged pull requests to other people\u2019s repositories show up here.", C.cream, 18));
  s.push(...placed, "</g>");
  return doc3("Where my pull requests landed", H, s.join(""), list.map((o) => `${o.label} (${o.merged})`).join(", "));
}
function languages3(v) {
  const H = 214;
  const langs = v.languages;
  const s = [tile(0, 0, CARD_WIDTH, H, C.mint)];
  const top = langs[0];
  s.push(big(34, 70, top ? `Mostly ${top.name}` : "No language data yet", C.ink, 44, CARD_WIDTH - 68, 24));
  const colors = [C.ink, C.cobalt, C.tangerine, C.grape, C.pink, C.sun, C.cream];
  let bx = 34;
  const bw = CARD_WIDTH - 68;
  langs.forEach((l, i) => {
    const w = l.share * bw;
    if (w < 2) return;
    s.push(`<rect x="${r(bx)}" y="96" width="${r(Math.max(2, w - 4))}" height="34" rx="17" fill="${colors[i % colors.length]}"/>`);
    bx += w;
  });
  let lx = 34;
  langs.forEach((l, i) => {
    const label = `${l.name} ${Math.round(l.share * 100)}%`;
    const w = measure(R53, label, 16) + 34;
    if (lx + w > CARD_WIDTH - 30) return;
    s.push(`<circle cx="${r(lx + 7)}" cy="165" r="7" fill="${colors[i % colors.length]}" stroke="${C.ink}" stroke-width="${colors[i % colors.length] === C.cream ? 1.5 : 0}"/>`);
    s.push(T3(lx + 20, 171, label, C.ink, 16));
    lx += w;
  });
  s.push("</g>");
  return doc3("Languages", H, s.join(""), langs.map((l) => `${l.name} ${Math.round(l.share * 100)}%`).join(", "));
}
function repos3(v) {
  const items = v.repos.slice(0, 3);
  const H = 250;
  if (!items.length) {
    const s2 = [tile(0, 0, CARD_WIDTH, 150, C.pink), T3(34, 70, "Repos coming soon", C.ink, 34, "x"), T3(36, 106, "Your most starred public repositories show up here.", C.ink, 18), "</g>"];
    return doc3("Repositories", 150, s2.join(""));
  }
  const gap = 12;
  const tw = (CARD_WIDTH - gap * (items.length - 1)) / items.length;
  const fills = [[C.pink, C.ink], [C.cobalt, C.cream], [C.tangerine, C.ink]];
  const s = [];
  items.forEach((rp, i) => {
    const x = i * (tw + gap);
    const [bg, fg] = fills[i];
    s.push(tile(x, 0, tw, H, bg, i * 0.08));
    const name = wrap(X8, rp.name.replace(/[-_]/g, " "), 26, tw - 52, 2);
    name.forEach((line, k) => s.push(T3(x + 26, 54 + k * 30, line, fg, 26, "x", ' letter-spacing="-0.6"')));
    wrap(R53, rp.description ?? "", 15, tw - 52, 3).forEach((line, k) => s.push(T3(x + 26, 54 + name.length * 30 + 12 + k * 20, line, fg, 15, "r", ' fill-opacity=".85"')));
    s.push(`<path d="${starPath(x + 40, H - 44, 14, 6.2)}" fill="${fg}"/>`);
    s.push(T3(x + 62, H - 32, formatInt(rp.stars), fg, 38, "x", ' letter-spacing="-1.5"'));
    s.push("</g>");
  });
  return doc3("Top repositories", H, s.join(""), items.map((rp) => `${rp.name}, ${rp.stars} stars`).join("; "));
}
function writing3(v, scheme) {
  const posts = v.posts.slice(0, 4);
  const H = posts.length ? 104 + posts.length * 58 : 150;
  const [bgTile, fgTile] = scheme === "dark" ? [C.cream, C.ink] : [C.ink, C.cream];
  const s = [tile(0, 0, CARD_WIDTH, H, bgTile)];
  s.push(T3(34, 62, posts.length ? "Fresh from the blog" : "Writing goes here", fgTile, 34, "x", ' letter-spacing="-1"'));
  if (!posts.length) {
    s.push(T3(36, 106, "Add your blog\u2019s RSS feed with the blog input.", fgTile, 18, "r", ' fill-opacity=".85"'));
  } else if (v.blogHost) {
    s.push(T3(CARD_WIDTH - 34, 60, v.blogHost, fgTile, 16, "r", ' text-anchor="end" fill-opacity=".7"'));
  }
  const chip = [[C.sun, C.ink], [C.pink, C.ink], [C.mint, C.ink], [C.cobalt, C.cream]];
  posts.forEach((p, i) => {
    const y = 88 + i * 58;
    const [bg, fg] = chip[i % chip.length];
    const date = p.date ? formatDate(p.date) : "";
    const d = pill(34, y, date || "new", bg, fg, 14);
    s.push(d.svg);
    s.push(T3(34 + d.w + 16, y + 23, fit(R53, p.title, 19, CARD_WIDTH - 34 - d.w - 16 - 34), fgTile, 19));
  });
  s.push("</g>");
  return doc3("Writing", H, s.join(""), posts.map((p) => p.title).join("; "));
}
var CARDS3 = { profile: profile3, stats: stats3, activity: activity3, upstream: upstream3, languages: languages3, repos: repos3, writing: writing3 };
var playful = {
  id: "playful",
  name: "Bold and playful",
  description: "Year-in-review energy: color blocks, huge numbers and a spinning sticker.",
  render: (card2, view, scheme) => CARDS3[card2](view, scheme)
};

// ../core/src/looks/terminal.ts
var PAL3 = {
  dark: {
    bg: "#0d1015",
    border: "#2a303a",
    title: "#ebe6d6",
    text: "#c6ccd5",
    dim: "#7b838f",
    faint: "#1d222b",
    key: "#7ec8e6",
    head: "#c4a7ff",
    ok: "#8fd49f",
    warn: "#f0c47c",
    ramp: "#f0c47c",
    sel: "#18202b",
    selbar: "#7ec8e6"
  },
  light: {
    bg: "#fbfaf6",
    border: "#d6d2c6",
    title: "#1f232a",
    text: "#383d46",
    dim: "#6c717b",
    faint: "#e9e6dc",
    key: "#1b6e95",
    head: "#6a42c8",
    ok: "#2c7a4c",
    warn: "#8e6209",
    ramp: "#1b6e95",
    sel: "#edf1f5",
    selbar: "#1b6e95"
  }
};
var M = "mono-400";
var B = "mono-700";
var FONTS = [M, B];
var SUP = ["\xB9", "\xB2", "\xB3", "\u2074", "\u2075", "\u2076", "\u2077"];
var CARD_ORDER = ["profile", "stats", "activity", "upstream", "languages", "repos", "writing"];
var CSS4 = `.t{font-family:${STACK.mono};font-weight:400}.b{font-family:${STACK.mono};font-weight:700}@keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}.cur{animation:blink 1.1s steps(1) infinite}` + REDUCED_MOTION(".cur");
var GLYPHS = {
  A: "01110100011000111111100011000110001",
  B: "11110100011000111110100011000111110",
  C: "01111100001000010000100001000001111",
  D: "11110100011000110001100011000111110",
  E: "11111100001000011110100001000011111",
  F: "11111100001000011110100001000010000",
  G: "01111100001000010011100011000101111",
  H: "10001100011000111111100011000110001",
  I: "11111001000010000100001000010011111",
  J: "00111000010000100001100011000101110",
  K: "10001100101010011000101001001010001",
  L: "10000100001000010000100001000011111",
  M: "10001110111010110101100011000110001",
  N: "10001110011010110011100011000110001",
  O: "01110100011000110001100011000101110",
  P: "11110100011000111110100001000010000",
  Q: "01110100011000110001101011001001101",
  R: "11110100011000111110101001001010001",
  S: "01111100001000001110000010000111110",
  T: "11111001000010000100001000010000100",
  U: "10001100011000110001100011000101110",
  V: "10001100011000110001100010101000100",
  W: "10001100011000110101101011010101010",
  X: "10001100010101000100010101000110001",
  Y: "10001100010101000100001000010000100",
  Z: "11111000010001000100010001000011111"
};
function T4(x, y, text, fill, size = 13, cls = "t", extra = "") {
  return `<text x="${r(x)}" y="${r(y)}" class="${cls}" font-size="${size}" fill="${fill}"${extra}>${esc(text)}</text>`;
}
function pane(P, x, y, w, h, card2, title, right) {
  const num = SUP[CARD_ORDER.indexOf(card2)] ?? "";
  const s = [`<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="6" fill="${P.bg}" stroke="${P.border}"/>`];
  const tx = x + 16;
  const tw = measure(B, title, 12) + 16;
  s.push(`<rect x="${tx - 6}" y="${y - 2}" width="${r(tw + 10)}" height="5" fill="${P.bg}"/>`);
  s.push(T4(tx, y + 4, num, P.key, 12));
  s.push(T4(tx + 11, y + 4, title, P.head, 12, "b"));
  if (right) {
    const text = fit(M, right, 12, w / 2 - 40);
    const rw = measure(M, text, 12);
    const rx = x + w - 16 - rw;
    s.push(`<rect x="${r(rx - 6)}" y="${y - 2}" width="${r(rw + 12)}" height="5" fill="${P.bg}"/>`);
    s.push(T4(rx, y + 4, text, P.dim, 12));
  }
  return s.join("");
}
function check(x, y, c) {
  return `<path d="M${x} ${y - 4} l3 3 l6 -7" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function footer(P, y, keys, right) {
  const s = [`<line x1="16" y1="${y - 16.5}" x2="${CARD_WIDTH - 16}" y2="${y - 16.5}" stroke="${P.border}"/>`];
  let x = 28;
  for (const [k, label] of keys) {
    s.push(T4(x, y, k, P.key, 12));
    x += measure(M, k, 12) + 7;
    s.push(T4(x, y, label, P.dim, 12));
    x += measure(M, label, 12) + 22;
  }
  s.push(T4(CARD_WIDTH - 44, y, right, P.dim, 12, "t", ' text-anchor="end"'));
  s.push(`<rect class="cur" x="${CARD_WIDTH - 38}" y="${y - 10}" width="7" height="13" fill="${P.key}"/>`);
  return s.join("");
}
function empty2(P, y, text) {
  return T4(CARD_WIDTH / 2, y, text, P.dim, 13, "t", ' text-anchor="middle"');
}
function doc4(card2, h, body, desc) {
  return svgDoc({ width: CARD_WIDTH, height: h, title: card2, ...desc ? { desc } : {}, fonts: FONTS, css: CSS4, body });
}
function profile4(v, P) {
  const H = 206;
  const s = [pane(P, 8, 10, CARD_WIDTH - 16, H - 18, "profile", "profile", `@${v.login}`)];
  const letters = [...v.name.toUpperCase()].filter((c) => GLYPHS[c] || c === " ").join("").trim().slice(0, 9);
  let bx = 32;
  if (letters.replace(/ /g, "").length >= 2) {
    const px = 6;
    const cell = 7;
    const cols = letters.length * 6 - 1;
    let col = 0;
    for (const ch of letters) {
      const g = GLYPHS[ch];
      if (g) {
        for (let i = 0; i < 35; i++) {
          if (g[i] !== "1") continue;
          const c = col + i % 5;
          s.push(`<rect x="${32 + c * cell}" y="${36 + Math.floor(i / 5) * cell}" width="${px}" height="${px}" rx="1" fill="${mix(P.head, P.key, c / Math.max(1, cols - 1))}"/>`);
        }
      }
      col += 6;
    }
    bx = 32 + cols * cell + 26;
  } else {
    s.push(T4(32, 74, fit(B, v.name, 30, 300), P.head, 30, "b"));
    bx = 32 + Math.min(300, measure(B, v.name, 30)) + 26;
  }
  const maxw = CARD_WIDTH - 32 - bx;
  if (v.headline) {
    const m = /^(.*?)\s*(@\S.*)$/.exec(v.headline);
    if (m && m[1]) {
      const a = fit(B, m[1], 15, maxw * 0.62);
      s.push(T4(bx, 56, a, P.title, 15, "b"));
      s.push(T4(bx + measure(B, a, 15) + 9, 56, fit(M, m[2], 15, maxw - measure(B, a, 15) - 9), P.key, 15));
    } else {
      s.push(T4(bx, 56, fit(B, v.headline, 15, maxw), P.title, 15, "b"));
    }
  }
  if (v.tagline.length) s.push(T4(bx, 78, fit(M, v.tagline.join(" \xB7 "), 13, maxw), P.dim, 13));
  s.push(`<line x1="24" y1="104.5" x2="${CARD_WIDTH - 24}" y2="104.5" stroke="${P.border}" stroke-dasharray="2 4"/>`);
  const since = `${formatDate(v.since)}${v.location ? ` \xB7 ${v.location}` : ""}`;
  const left = [];
  if (v.focus.length) left.push(["Focus", v.focus.slice(0, 3).join(" \xB7 "), P.text]);
  if (v.focus.length > 3) left.push(["Stack", v.focus.slice(3, 6).join(" \xB7 "), P.text]);
  left.push(["Since", since, P.text]);
  const right = [];
  v.programs.slice(0, 2).forEach((p, i) => right.push([i === 0 ? "Programs" : "", p, P.text]));
  if (v.website) right.push(["Web", v.website, P.key]);
  if (right.length < 3) right.push(["Followers", formatInt(v.followers), P.text]);
  const rows = (items, x, vx, maxv) => items.slice(0, 3).forEach(([k, val, tone], i) => {
    const y = 132 + i * 22;
    if (k) s.push(T4(x, y, `${k}:`, P.dim, 13));
    s.push(T4(vx, y, fit(M, val, 13, maxv), tone, 13));
  });
  rows(left, 32, 110, 300);
  rows(right, 436, 530, CARD_WIDTH - 32 - 530);
  return doc4(`${v.name} on GitHub`, H, s.join(""), [v.headline, ...v.tagline].filter(Boolean).join(". "));
}
function stats4(v, P) {
  const H = 170;
  const st = v.stats;
  const s = [pane(P, 8, 10, CARD_WIDTH - 16, H - 18, "stats", "stats", "last 12 months")];
  const cols = [
    [
      ["merged upstream", st.mergedUpstream, `into ${formatInt(st.upstreamOwners)} ${st.upstreamOwners === 1 ? "org" : "orgs"}`, P.ok],
      ["stars earned", st.stars, `on ${formatInt(st.repos)} repos`, P.title],
      ["followers", st.followers, "", P.title]
    ],
    [
      ["contributions", st.contributions, "in 12 months", P.title],
      ["active days", st.activeDays, "of 365", P.title],
      ["best streak", st.longestStreak, st.longestStreak === 1 ? "day" : "days", P.title]
    ]
  ];
  cols.forEach((col, c) => {
    const x = c === 0 ? 30 : 440;
    col.forEach(([label, val, ctx, tone], i) => {
      const y = 50 + i * 36;
      s.push(T4(x, y, label, P.dim, 13));
      s.push(T4(x + 222, y, formatInt(val), tone, 13, "b", ' text-anchor="end"'));
      if (ctx) s.push(T4(x + 236, y, ctx, P.dim, 12));
    });
  });
  s.push(`<line x1="${CARD_WIDTH / 2 + 0.5}" y1="34" x2="${CARD_WIDTH / 2 + 0.5}" y2="${H - 30}" stroke="${P.border}" stroke-dasharray="2 4"/>`);
  return doc4("GitHub stats", H, s.join(""), `${st.mergedUpstream} pull requests merged into other projects, ${st.stars} stars, ${st.contributions} contributions in the last year.`);
}
function activity4(v, P) {
  const H = 196;
  const s = [pane(P, 8, 10, CARD_WIDTH - 16, H - 18, "activity", "activity", `${formatInt(v.stats.contributions)} contributions \xB7 52 weeks`)];
  const weeks = v.weeks;
  const mx = Math.max(1, ...weeks.map((w) => w.total));
  const rows = 9;
  const dx = 560 / Math.max(1, weeks.length - 1);
  const x0 = 32;
  const base = 148;
  weeks.forEach((w, i) => {
    const h = w.total === 0 ? 0 : Math.max(1, Math.round(Math.log1p(w.total) / Math.log1p(mx) * rows));
    const cx = x0 + i * dx;
    for (let k = 0; k < rows; k++) {
      const cy = base - k * 11;
      if (k < h) s.push(`<circle cx="${r(cx)}" cy="${cy}" r="2.7" fill="${mix(P.key, P.head, k / (rows - 1))}"/>`);
      else s.push(`<circle cx="${r(cx)}" cy="${cy}" r="1.4" fill="${P.faint}"/>`);
    }
    if (i > 0 && w.start.slice(5, 7) !== weeks[i - 1].start.slice(5, 7)) {
      s.push(T4(cx - 4, 172, shortMonth(w.start).toLowerCase(), P.dim, 11));
    }
  });
  const facts = [
    ["busiest wk", v.busiestWeek ? formatInt(v.busiestWeek.total) : "0", v.busiestWeek ? formatDayMonth(v.busiestWeek.start) : ""],
    ["best day", v.bestDay ? formatInt(v.bestDay.count) : "0", v.bestDay ? formatDayMonth(v.bestDay.date) : ""],
    ["active", formatInt(v.stats.activeDays), "days"],
    ["streak", formatInt(v.stats.currentStreak), "now"]
  ];
  s.push(`<line x1="620.5" y1="34" x2="620.5" y2="170" stroke="${P.border}" stroke-dasharray="2 4"/>`);
  facts.forEach(([k, val, ctx], i) => {
    const y = 54 + i * 28;
    s.push(T4(640, y, k, P.dim, 12));
    s.push(T4(752, y, val, P.title, 13, "b", ' text-anchor="end"'));
    s.push(T4(760, y, ctx, P.dim, 12));
  });
  return doc4("Contribution activity", H, s.join(""), `${v.stats.contributions} contributions in the last 52 weeks.`);
}
function upstream4(v, P) {
  const rows = v.upstream.slice(0, 7);
  const H = rows.length ? 88 + rows.length * 26 + 30 : 150;
  const st = v.stats;
  const s = [pane(P, 8, 10, CARD_WIDTH - 16, H - 18, "upstream", "upstream", `${formatInt(st.mergedUpstream)} merged \xB7 ${formatInt(st.upstreamOwners)} orgs`)];
  if (!rows.length) {
    s.push(empty2(P, 84, "no merged pull requests to other people\u2019s repositories yet"));
    return doc4("Merged pull requests upstream", H, s.join(""));
  }
  const hdr = (x, text, anchor = "") => s.push(T4(x, 46, text, P.dim, 11, "t", anchor));
  hdr(50, "REPOSITORY");
  hdr(306, "STARS", ' text-anchor="end"');
  hdr(324, "LATEST MERGED PULL REQUEST");
  hdr(730, "PRS", ' text-anchor="end"');
  hdr(CARD_WIDTH - 30, "MERGED", ' text-anchor="end"');
  rows.forEach((u, i) => {
    const y = 74 + i * 26;
    if (i === 0) {
      s.push(`<rect x="16" y="${y - 17}" width="${CARD_WIDTH - 32}" height="25" rx="3" fill="${P.sel}"/>`);
      s.push(`<rect x="16" y="${y - 17}" width="2" height="25" fill="${P.selbar}"/>`);
    }
    s.push(check(28, y - 1, P.ok));
    s.push(T4(50, y, fit(M, u.repo, 13, 200), P.key, 13, i === 0 ? "b" : "t"));
    s.push(T4(306, y, compactNumber(u.stars), P.warn, 13, "t", ' text-anchor="end"'));
    s.push(T4(324, y, fit(M, u.latest.title, 13, 370), i === 0 ? P.title : P.text, 13));
    s.push(T4(730, y, String(u.merged), P.dim, 13, "t", ' text-anchor="end"'));
    s.push(T4(CARD_WIDTH - 30, y, formatDayMonth(u.latest.mergedAt.slice(0, 10)), P.dim, 13, "t", ' text-anchor="end"'));
  });
  s.push(footer(P, H - 22, [["<enter>", "open"], ["</>", "filter"], ["<tab>", "next pane"]], "ranked by project and PR size"));
  return doc4("Merged pull requests upstream", H, s.join(""), `${st.mergedUpstream} pull requests merged into ${st.upstreamRepos} repositories owned by others.`);
}
function languages4(v, P) {
  const langs = v.languages;
  const H = langs.length ? 58 + langs.length * 25 + 8 : 130;
  const s = [pane(P, 8, 10, CARD_WIDTH - 16, H - 18, "languages", "languages", "by code size")];
  if (!langs.length) {
    s.push(empty2(P, 72, "no language data yet"));
    return doc4("Languages", H, s.join(""));
  }
  const top = Math.max(...langs.map((l) => l.share));
  const seg = 6;
  const gap = 2;
  const n = 64;
  langs.forEach((l, i) => {
    const y = 50 + i * 25;
    const other = l.name === "Other";
    s.push(T4(30, y, fit(M, l.name, 13, 140), other ? P.dim : P.text, 13));
    const lit = Math.max(1, Math.round(l.share / top * n));
    for (let k = 0; k < n; k++) {
      const fill = k < lit ? other ? P.dim : mix(P.ok, P.ramp, k / (n - 1)) : P.faint;
      s.push(`<rect x="${190 + k * (seg + gap)}" y="${y - 10}" width="${seg}" height="11" rx="1" fill="${fill}"/>`);
    }
    s.push(T4(CARD_WIDTH - 30, y, `${(l.share * 100).toFixed(l.share < 0.1 ? 1 : 0)}%`, P.title, 12, "b", ' text-anchor="end"'));
  });
  return doc4("Languages", H, s.join(""), langs.map((l) => `${l.name} ${(l.share * 100).toFixed(0)}%`).join(", "));
}
function repos4(v, P) {
  const rows = v.repos;
  const H = rows.length ? 84 + rows.length * 26 : 130;
  const s = [pane(P, 8, 10, CARD_WIDTH - 16, H - 18, "repos", "repositories", "by stars")];
  if (!rows.length) {
    s.push(empty2(P, 72, "no public repositories yet"));
    return doc4("Repositories", H, s.join(""));
  }
  const hdr = (x, text, anchor = "") => s.push(T4(x, 46, text, P.dim, 11, "t", anchor));
  hdr(30, "NAME");
  hdr(240, "DESCRIPTION");
  hdr(612, "LANG");
  hdr(746, "STARS", ' text-anchor="end"');
  hdr(CARD_WIDTH - 30, "FORKS", ' text-anchor="end"');
  rows.forEach((rp, i) => {
    const y = 74 + i * 26;
    if (i === 0) {
      s.push(`<rect x="16" y="${y - 17}" width="${CARD_WIDTH - 32}" height="25" rx="3" fill="${P.sel}"/>`);
      s.push(`<rect x="16" y="${y - 17}" width="2" height="25" fill="${P.selbar}"/>`);
    }
    s.push(T4(30, y, fit(M, rp.name, 13, 196), P.key, 13, i === 0 ? "b" : "t"));
    s.push(T4(240, y, fit(M, rp.description ?? "", 13, 358), i === 0 ? P.title : P.text, 13));
    s.push(T4(612, y, fit(M, (rp.language ?? "").toLowerCase(), 12, 84), P.dim, 12));
    s.push(T4(746, y, formatInt(rp.stars), P.warn, 13, "t", ' text-anchor="end"'));
    s.push(T4(CARD_WIDTH - 30, y, formatInt(rp.forks), P.dim, 13, "t", ' text-anchor="end"'));
  });
  return doc4("Top repositories", H, s.join(""), rows.map((rp) => `${rp.name}, ${rp.stars} stars`).join("; "));
}
function writing4(v, P) {
  const rows = v.posts;
  const H = rows.length ? 50 + rows.length * 26 + 8 : 130;
  const s = [pane(P, 8, 10, CARD_WIDTH - 16, H - 18, "writing", "writing", v.blogHost ?? "blog")];
  if (!rows.length) {
    s.push(empty2(P, 72, "add your blog feed with the blog input to list posts here"));
    return doc4("Writing", H, s.join(""));
  }
  rows.forEach((p, i) => {
    const y = 48 + i * 26;
    s.push(T4(30, y, p.date ?? "", P.dim, 13));
    s.push(T4(146, y, fit(M, p.title, 13, CARD_WIDTH - 146 - 40), i === 0 ? P.title : P.text, 13, i === 0 ? "b" : "t"));
  });
  return doc4("Writing", H, s.join(""), rows.map((p) => p.title).join("; "));
}
var CARDS4 = { profile: profile4, stats: stats4, activity: activity4, upstream: upstream4, languages: languages4, repos: repos4, writing: writing4 };
var terminal = {
  id: "terminal",
  name: "Modern terminal",
  description: "TUI panes with titles in the border, segmented meters and a dot-matrix activity graph.",
  render: (card2, view, scheme) => CARDS4[card2](view, PAL3[scheme])
};

// ../core/src/looks/index.ts
var LOOKS = { terminal, clean, ops, playful };

// ../core/src/options.ts
var DEFAULT_LOOK = "clean";
var DEFAULT_CARDS = ["profile", "stats", "activity", "upstream", "languages"];
var OptionsError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "OptionsError";
  }
};
var MAX_PROGRAMS = 4;
var MAX_LINE = 80;
function lines(value) {
  return (value ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
function parseLook(value) {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return DEFAULT_LOOK;
  if (LOOK_IDS.includes(v)) return v;
  throw new OptionsError(`Unknown look "${value}". Use one of: ${LOOK_IDS.join(", ")}.`);
}
function parseCards(value) {
  const items = (value ?? "").split(/[\s,]+/).map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (items.length === 0) return [...DEFAULT_CARDS];
  const unknown = items.filter((c) => !CARD_IDS.includes(c));
  if (unknown.length) throw new OptionsError(`Unknown card "${unknown[0]}". Use any of: ${CARD_IDS.join(", ")}.`);
  return [...new Set(items)];
}
function parseFeeds(value) {
  const feeds = (value ?? "").split(/[\s,]+/).map((f) => f.trim()).filter(Boolean);
  for (const f of feeds) {
    let url;
    try {
      url = new URL(f);
    } catch {
      throw new OptionsError(`"${f}" is not a valid feed URL.`);
    }
    if (url.protocol !== "https:") throw new OptionsError(`Feed URLs must use https: ${f}`);
  }
  return feeds.slice(0, 3);
}
function parsePrograms(value) {
  const items = lines(value);
  const long = items.find((p) => p.length > MAX_LINE);
  if (long) throw new OptionsError(`Keep each program under ${MAX_LINE} characters: "${long.slice(0, 40)}\u2026"`);
  return items.slice(0, MAX_PROGRAMS);
}
function parseHeadline(value) {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (!v) return null;
  if (v.length > MAX_LINE) throw new OptionsError(`Keep the headline under ${MAX_LINE} characters.`);
  return v;
}
function isLogin(value) {
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(value);
}
function parseOptions(input2) {
  return {
    look: parseLook(input2.look),
    cards: parseCards(input2.cards),
    headline: parseHeadline(input2.headline),
    programs: parsePrograms(input2.programs),
    feeds: parseFeeds(input2.blog)
  };
}

// ../core/src/output.ts
var OUTPUT_BRANCH = "readmeops";
function cardFileName(card2, scheme) {
  return `${card2}-${scheme}.svg`;
}
function renderCards(view, look, cards) {
  const renderer = LOOKS[look];
  return cards.flatMap((card2) => SCHEMES.map((scheme) => ({ path: cardFileName(card2, scheme), svg: renderer.render(card2, view, scheme) })));
}
var ALT = {
  profile: "Profile",
  stats: "GitHub stats",
  activity: "Contribution activity",
  upstream: "Pull requests merged into other projects",
  languages: "Languages",
  repos: "Top repositories",
  writing: "Latest writing"
};
function cardLink(card2, login, blogUrl = null) {
  const profile5 = `https://github.com/${login}`;
  switch (card2) {
    case "upstream":
      return `https://github.com/search?q=${encodeURIComponent(`author:${login} is:pr is:merged -user:${login}`).replace(/%20/g, "+")}&type=pullrequests`;
    case "repos":
      return `${profile5}?tab=repositories&sort=stargazers`;
    case "stats":
    case "languages":
      return `${profile5}?tab=repositories`;
    case "writing":
      return blogUrl ?? profile5;
    default:
      return profile5;
  }
}
function rawUrl(repository, file) {
  return `https://raw.githubusercontent.com/${repository}/${OUTPUT_BRANCH}/${file}`;
}
function readmeSnippet(login, cards, blogUrl = null, repository = `${login}/${login}`) {
  return cards.map(
    (card2) => `<a href="${cardLink(card2, login, blogUrl)}"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="${rawUrl(repository, cardFileName(card2, "dark"))}">
  <img alt="${ALT[card2]}" src="${rawUrl(repository, cardFileName(card2, "light"))}" width="100%">
</picture></a>`
  ).join("\n\n");
}

// ../core/src/fixtures/demo.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var LANG = {
  Python: "#3572A5",
  Go: "#00ADD8",
  HCL: "#844FBA",
  TypeScript: "#3178c6",
  Shell: "#89e051",
  Dockerfile: "#384d54",
  Smarty: "#f0c040"
};
function repo(name, stars, langs, opts) {
  return {
    nameWithOwner: `ada-ops/${name}`,
    name,
    owner: "ada-ops",
    description: opts.description,
    url: `https://github.com/ada-ops/${name}`,
    visibility: opts.visibility ?? "public",
    isFork: false,
    isArchived: opts.archived ?? false,
    stars,
    forks: opts.forks ?? Math.floor(stars / 4),
    primaryLanguage: { name: langs[0][0], color: LANG[langs[0][0]] },
    languages: langs.map(([n, bytes]) => ({ name: n, color: LANG[n], bytes })),
    topics: opts.topics ?? [],
    pushedAt: `${opts.pushed}T10:00:00Z`
  };
}
function demoProfile(now = /* @__PURE__ */ new Date("2026-09-26T12:00:00Z"), mode = "public") {
  const rand = mulberry32(42);
  const today = dateKey(now);
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const date = addDays(today, -i);
    const dow = (/* @__PURE__ */ new Date(`${date}T00:00:00Z`)).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const active = rand() < (weekend ? 0.3 : 0.7);
    const burst = rand() < 0.05 ? 3 : 1;
    days.push({ date, count: active ? Math.max(1, Math.round((1 + rand() * (weekend ? 3 : 7)) * burst)) : 0 });
  }
  for (let k = 0; k < 9; k++) {
    const d = days[days.length - 1 - k];
    if (d.count === 0) d.count = 2 + k;
  }
  const total = days.reduce((s, d) => s + d.count, 0);
  const repos5 = [
    repo("kube-cost-lens", 214, [["Go", 182e3], ["Shell", 9e3]], {
      description: "FinOps lens for Kubernetes: per-namespace cost and idle-capacity reports",
      topics: ["kubernetes", "finops", "prometheus"],
      pushed: "2026-09-20"
    }),
    repo("airflow-on-eks", 138, [["HCL", 96e3], ["Python", 64e3], ["Smarty", 12e3]], {
      description: "Production Apache Airflow 3 on EKS with Terraform, Karpenter and GitOps",
      topics: ["airflow", "eks", "terraform", "kubernetes"],
      pushed: "2026-09-12"
    }),
    repo("gpu-train-infra", 97, [["HCL", 12e4], ["Python", 22e3], ["Shell", 6e3]], {
      description: "Terraform modules for spot GPU training clusters with checkpoint-safe preemption",
      topics: ["mlops", "gpu", "terraform"],
      pushed: "2026-09-24"
    }),
    repo("readme-sre", 41, [["TypeScript", 88e3], ["Shell", 3e3]], {
      description: "Postmortem and runbook templates that render nicely on GitHub",
      topics: ["sre"],
      pushed: "2026-07-30"
    }),
    repo("helm-charts", 33, [["Smarty", 44e3], ["Shell", 4e3]], {
      description: "Hardened Helm charts with sane defaults and network policies",
      topics: ["kubernetes", "helm"],
      pushed: "2026-05-02"
    }),
    repo("llm-gateway-bench", 29, [["Python", 71e3], ["Dockerfile", 2e3]], {
      description: "Load tests for LLM gateways: latency, cost and cache hit rates",
      topics: ["mlops", "benchmark"],
      pushed: "2026-09-01"
    }),
    repo("url-shortener-k8s", 9, [["TypeScript", 22e3], ["Dockerfile", 1200]], {
      description: "Capstone: URL shortener deployed with ArgoCD",
      pushed: "2024-02-01",
      archived: true
    })
  ];
  if (mode === "private") {
    repos5.push(
      repo("client-platform", 0, [["HCL", 21e4], ["Python", 4e4]], {
        description: "Private client platform",
        pushed: "2026-09-25",
        visibility: "private"
      })
    );
  }
  const upstreamRepos = [
    ["airflux/airflux", 36e3],
    ["meshcraft/meshcraft", 12100],
    ["kube-forge/scheduler", 8200],
    ["opensloth/agentd", 5400],
    ["kube-forge/conformance", 1200],
    ["tinyinfra/tf-lint-rules", 640]
  ];
  const titles = [
    "Support workload identity in KubernetesPodOperator",
    "Handle 429 from registry with backoff",
    "Fix race in leader election on node drain",
    "Expose queue depth metric",
    "Add conformance results for v1.34",
    "Add rule for unpinned module sources",
    "Reduce memory in DAG parsing for large deployments",
    "Document GPU scheduling with node affinity"
  ];
  const items = [];
  for (let k = 0; k < 23; k++) {
    const [name, stars] = upstreamRepos[k % upstreamRepos.length];
    const merged = addDays(today, -Math.floor(rand() * 420) - 2);
    items.push({
      title: titles[k % titles.length],
      url: `https://github.com/${name}/pull/${1e3 + k}`,
      number: 1e3 + k,
      mergedAt: `${merged}T09:00:00Z`,
      changedLines: 8 + Math.floor(rand() * 400),
      repo: { nameWithOwner: name, owner: name.split("/")[0], url: `https://github.com/${name}`, stars, visibility: "public" }
    });
  }
  items.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  return {
    schemaVersion: 2,
    mode,
    generatedAt: now.toISOString(),
    user: {
      login: "ada-ops",
      name: "Ada Ops",
      bio: "I make clusters boring and pipelines fast | Kubernetes | MLOps",
      company: "@example-cloud",
      location: "Bengaluru, India",
      websiteUrl: "https://example.com",
      twitterUsername: null,
      avatarUrl: "https://avatars.githubusercontent.com/u/9919?v=4",
      avatarDataUri: null,
      url: "https://github.com/ada-ops",
      createdAt: "2023-01-21T08:00:00Z",
      followers: 312
    },
    repos: repos5,
    contributions: { days, total, restricted: 0 },
    upstream: { total: items.length, items },
    posts: [
      { title: "How I cut our EKS bill by 38% without touching app code", url: "https://example.com/blog/eks-bill", publishedAt: "2026-09-02T00:00:00Z", summary: null, source: "example.com" },
      { title: "Airflow 3 on Kubernetes: the upgrade checklist", url: "https://example.com/blog/airflow-3", publishedAt: "2026-07-14T00:00:00Z", summary: null, source: "example.com" },
      { title: "Checkpoint-safe GPU training on spot instances", url: "https://example.com/blog/spot-gpu", publishedAt: "2026-05-30T00:00:00Z", summary: null, source: "example.com" },
      { title: "A runbook template your on-call will actually read", url: "https://example.com/blog/runbooks", publishedAt: "2026-03-18T00:00:00Z", summary: null, source: "example.com" }
    ],
    programs: ["Cloud Community Builder", "Open Source Mentee \u201923"],
    headline: "Platform & MLOps engineer at Example Cloud",
    warnings: []
  };
}

// src/main.ts
var execFileP = promisify(execFile);
function input(name, fallback = "") {
  const value = process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`];
  return value !== void 0 && value.trim() !== "" ? value : fallback;
}
function bool(name, fallback) {
  const v = input(name, String(fallback)).trim().toLowerCase();
  if (["true", "1", "yes"].includes(v)) return true;
  if (["false", "0", "no"].includes(v)) return false;
  throw new OptionsError(`Input "${name}" must be true or false.`);
}
function escapeCommand(value) {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
var log = (m) => process.stdout.write(`${m}
`);
var warn = (m) => process.stdout.write(`::warning::${escapeCommand(m)}
`);
var fail = (m) => process.stdout.write(`::error::${escapeCommand(m)}
`);
async function setOutput(name, value) {
  const file = process.env["GITHUB_OUTPUT"];
  if (!file) return;
  const delimiter = `readmeops_${Math.random().toString(36).slice(2)}`;
  await appendFile(file, `${name}<<${delimiter}
${value}
${delimiter}
`);
}
async function summary(markdown) {
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file) await appendFile(file, `${markdown}
`);
}
async function git(args, cwd) {
  const { stdout } = await execFileP("git", args, { cwd });
  return stdout;
}
var BRANCH_README = `# readmeops cards

Generated by the readmeops workflow. Every run replaces this branch with a single
commit, so do not edit files here. Your README links to them.
`;
async function publish(files, remote, token) {
  const dir = await mkdtemp(join(tmpdir(), "readmeops-"));
  const auth = token ? ["-c", `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`] : [];
  try {
    const current = /* @__PURE__ */ new Map();
    try {
      await git([...auth, "clone", "--quiet", "--depth", "1", "--single-branch", "--branch", OUTPUT_BRANCH, remote, "current"], dir);
      for (const f of await readdir(join(dir, "current"))) {
        if (f.endsWith(".svg")) current.set(f, await readFile(join(dir, "current", f), "utf8"));
      }
    } catch {
    }
    if (current.size === files.length && files.every((f) => current.get(f.path) === f.svg)) return "unchanged";
    const out = join(dir, "out");
    await mkdir(out);
    await git(["init", "--quiet", "-b", OUTPUT_BRANCH], out);
    for (const f of files) await writeFile(join(out, f.path), f.svg);
    await writeFile(join(out, "README.md"), BRANCH_README);
    await git(["add", "--all"], out);
    await git(
      ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "--quiet", "-m", "readmeops: refresh cards"],
      out
    );
    await git([...auth, "push", "--force", "--quiet", remote, `HEAD:refs/heads/${OUTPUT_BRANCH}`], out);
    return "pushed";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function main() {
  const token = input("token").trim();
  if (token) log(`::add-mask::${token}`);
  const options = parseOptions({
    look: input("look"),
    cards: input("cards"),
    headline: input("headline"),
    programs: input("programs"),
    blog: input("blog")
  });
  const repository = process.env["GITHUB_REPOSITORY"] ?? "";
  const user = input("user", process.env["GITHUB_REPOSITORY_OWNER"] ?? repository.split("/")[0] ?? "").trim();
  if (!isLogin(user)) throw new OptionsError(`"${user}" is not a valid GitHub username. Set the user input.`);
  const dryRun = bool("dry-run", false);
  const demo = process.env["READMEOPS_DEMO"];
  log(`::group::readmeops: ${options.look} look for ${user}`);
  let data;
  if (demo) {
    data = demoProfile(/* @__PURE__ */ new Date(), demo === "private" ? "private" : "public");
    data.headline = options.headline ?? data.headline;
    if (options.programs.length) data.programs = options.programs;
    assertPublicSafe(data);
  } else {
    if (!token) throw new OptionsError("No token. Keep the default token input (the workflow's GITHUB_TOKEN).");
    data = await collectProfile({
      user,
      token,
      mode: "public",
      feeds: options.feeds,
      programs: options.programs,
      headline: options.headline,
      log
    });
  }
  const view = buildView(data);
  const files = renderCards(view, options.look, options.cards);
  log(`rendered ${files.length} files: ${files.map((f) => f.path).join(", ")}`);
  log("::endgroup::");
  for (const w of data.warnings) warn(w);
  let result = "dry run";
  if (!dryRun) {
    const remote = process.env["READMEOPS_REMOTE"] ?? `${process.env["GITHUB_SERVER_URL"] ?? "https://github.com"}/${repository}.git`;
    result = await publish(files, remote, token);
  }
  await setOutput("changed", String(result === "pushed"));
  await setOutput("files", files.map((f) => f.path).join("\n"));
  const blogUrl = options.feeds[0] ? `https://${new URL(options.feeds[0]).host}` : view.websiteUrl;
  await summary(
    [
      `### readmeops: ${result === "pushed" ? "cards updated" : result === "unchanged" ? "no changes" : "dry run"}`,
      "",
      `${files.length} files on the \`${OUTPUT_BRANCH}\` branch (${options.look} look). Paste this into your README once:`,
      "",
      "```html",
      readmeSnippet(user, options.cards, blogUrl, repository || `${user}/${user}`),
      "```",
      ...data.warnings.length ? ["", "Warnings:", ...data.warnings.map((w) => `- ${w}`)] : []
    ].join("\n")
  );
  log(result === "pushed" ? `pushed updated cards to ${OUTPUT_BRANCH}` : result === "unchanged" ? "cards unchanged" : "dry run: nothing pushed");
  return 0;
}
if (process.env["GITHUB_ACTIONS"] === "true" || process.env["READMEOPS_ACTION_RUN"] === "1") {
  main().then(
    (code) => process.exit(code),
    (err) => {
      if (err instanceof PrivacyError || err instanceof OptionsError) fail(err.message);
      else fail(`readmeops failed: ${err.message ?? String(err)}`);
      process.exit(1);
    }
  );
}
export {
  bool,
  input,
  main,
  publish
};
