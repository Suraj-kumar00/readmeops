"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildView,
  CARD_IDS,
  DEFAULT_CARDS,
  demoProfile,
  isLogin,
  LOOK_IDS,
  LOOKS,
  newWorkflowUrl,
  readmeSnippet,
  workflowYaml,
  type CardId,
  type LookId,
  type PostInfo,
  type ProfileData,
  type Scheme,
} from "@readmeops/core";

interface Viewer {
  login: string;
  name: string | null;
  installed: boolean;
}

interface Props {
  viewer: Viewer | null;
  signInAvailable: boolean;
  canInstall: boolean;
  live: boolean;
}

type Source = "sample" | "public" | "private";

const CARD_LABELS: Record<CardId, string> = {
  profile: "Profile",
  stats: "Numbers",
  activity: "Activity",
  upstream: "Upstream PRs",
  languages: "Languages",
  repos: "Repositories",
  writing: "Writing",
};

const SAMPLE = demoProfile();

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function svgUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

function Copy({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <button
      type="button"
      className="copy"
      aria-label={`Copy ${label}`}
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setState("done"),
          () => setState("failed"),
        );
        setTimeout(() => setState("idle"), 1600);
      }}
    >
      {state === "done" ? "Copied" : state === "failed" ? "Select and copy" : "Copy"}
    </button>
  );
}

export function Editor({ viewer, signInAvailable, canInstall, live }: Props) {
  const [input, setInput] = useState(viewer?.login ?? "");
  const [data, setData] = useState<ProfileData>(SAMPLE);
  const [branch, setBranch] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("sample");
  const [publicLogin, setPublicLogin] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [look, setLook] = useState<LookId>("clean");
  const [scheme, setScheme] = useState<Scheme>("dark");
  const [cards, setCards] = useState<Array<{ id: CardId; on: boolean }>>(() => {
    const on = new Set<CardId>(DEFAULT_CARDS);
    return [...DEFAULT_CARDS, ...CARD_IDS.filter((c) => !on.has(c))].map((id) => ({ id, on: on.has(id) }));
  });
  const [headline, setHeadline] = useState("");
  const [programs, setPrograms] = useState("");
  const [blog, setBlog] = useState("");
  const [posts, setPosts] = useState<PostInfo[] | null>(null);
  const [feedState, setFeedState] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (window.matchMedia("(prefers-color-scheme: light)").matches) setScheme("light");
    } catch {
      /* keep dark */
    }
    const params = new URLSearchParams(window.location.search);
    const auth = params.get("auth");
    if (auth) {
      setError(auth === "unconfigured" ? "Sign-in is not set up on this server." : "Sign-in did not complete. Try again.");
      const url = new URL(window.location.href);
      url.searchParams.delete("auth");
      window.history.replaceState(null, "", url);
    }
    const user = params.get("user");
    if (user && isLogin(user)) {
      setInput(user);
      void loadPublic(user);
    } else if (viewer && live) {
      void loadPublic(viewer.login);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPublic(login: string) {
    if (!isLogin(login)) {
      setError("That is not a valid GitHub username.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getJson<{ data: ProfileData; profileBranch: string | null }>(`/api/profile?user=${encodeURIComponent(login)}`);
      setData(res.data);
      setBranch(res.profileBranch);
      setSource("public");
      setPublicLogin(res.data.user.login);
      const url = new URL(window.location.href);
      url.searchParams.set("user", res.data.user.login);
      window.history.replaceState(null, "", url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadPrivate() {
    setLoading(true);
    setError(null);
    try {
      const res = await getJson<{ data: ProfileData; profileBranch: string | null }>("/api/me");
      setData(res.data);
      setBranch(res.profileBranch);
      setSource("private");
      setPublicLogin(res.data.user.login);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadFeed() {
    const url = blog.trim();
    if (!url) {
      setPosts(null);
      setFeedState(null);
      return;
    }
    setFeedState("Loading posts…");
    try {
      const res = await getJson<{ posts: PostInfo[] }>(`/api/feed?url=${encodeURIComponent(url)}`);
      setPosts(res.posts);
      setFeedState(`${res.posts.length} posts loaded`);
    } catch (err) {
      setPosts(null);
      setFeedState((err as Error).message);
    }
  }

  const login = publicLogin ?? (isLogin(input.trim()) ? input.trim() : "your-username");
  const activeCards = cards.filter((c) => c.on).map((c) => c.id);
  const view = useMemo(
    () =>
      buildView({
        ...data,
        headline: headline.trim() || data.headline,
        programs: programs.trim() ? lines(programs) : data.programs,
        posts: posts ?? data.posts,
      }),
    [data, headline, programs, posts],
  );
  const images = useMemo(
    () => activeCards.map((id) => ({ id, uri: svgUri(LOOKS[look].render(id, view, scheme)) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, look, scheme, activeCards.join(",")],
  );
  const options = {
    look,
    cards: activeCards.length ? activeCards : (["profile"] as CardId[]),
    headline: headline.trim() || null,
    programs: lines(programs),
    feeds: blog.trim() ? [blog.trim()] : [],
  };
  const yaml = workflowYaml(login, options);
  const blogHome = (() => {
    try {
      return blog.trim() ? `https://${new URL(blog.trim()).host}` : view.websiteUrl;
    } catch {
      return view.websiteUrl;
    }
  })();
  const snippet = readmeSnippet(login, options.cards, blogHome);
  const ready = source !== "sample";
  const isOwner = viewer !== null && publicLogin !== null && viewer.login.toLowerCase() === publicLogin.toLowerCase();

  function move(index: number, delta: number) {
    setCards((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <>
      <header className="top">
        <a className="brand" href="/">
          <svg viewBox="0 0 18 18" aria-hidden="true">
            <rect x="1" y="1" width="7" height="7" rx="1.5" fill="currentColor" />
            <rect x="10" y="1" width="7" height="7" rx="1.5" fill="currentColor" opacity=".45" />
            <rect x="1" y="10" width="7" height="7" rx="1.5" fill="currentColor" opacity=".45" />
            <rect x="10" y="10" width="7" height="7" rx="1.5" fill="currentColor" opacity=".2" />
          </svg>
          readmeops
        </a>
        <nav className="top-links">
          <a href="https://github.com/Suraj-kumar00/readmeops" target="_blank" rel="noopener noreferrer">
            Source
          </a>
          {viewer ? (
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="link">
                Sign out @{viewer.login}
              </button>
            </form>
          ) : signInAvailable ? (
            <a href="/api/auth/login">Sign in to see private work</a>
          ) : null}
        </nav>
      </header>

      <main className="wrap">
        <section className="intro">
          <h1>Your GitHub profile, with proof</h1>
          <p>
            Pick a look, choose your cards, then add them to your profile. The cards are rendered by a workflow in your own
            repository, so nothing loads from a server when someone views your profile.
          </p>
        </section>

        <section className="editor" aria-label="Editor">
          <aside className="rail">
            <form
              className="field"
              onSubmit={(e) => {
                e.preventDefault();
                void loadPublic(input.trim());
              }}
            >
              <label htmlFor="user">GitHub username</label>
              <div className="userbox">
                <span aria-hidden="true">@</span>
                <input
                  id="user"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="your-username"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!live}
                />
                <button type="submit" className="go" disabled={!live || loading}>
                  {loading ? "Loading" : "Load"}
                </button>
              </div>
              {!live && <p className="note">Live profiles are off on this server. You are seeing a sample profile.</p>}
              {live && source === "sample" && <p className="note">Showing a sample profile. Type any GitHub username.</p>}
              {error && (
                <p className="note error" role="alert">
                  {error}
                </p>
              )}
            </form>

            {isOwner && (
              <fieldset>
                <legend>Viewing</legend>
                <div className="seg" role="radiogroup" aria-label="Whose view">
                  <button type="button" role="radio" aria-checked={source === "public"} onClick={() => publicLogin && void loadPublic(publicLogin)}>
                    What everyone sees
                  </button>
                  <button type="button" role="radio" aria-checked={source === "private"} onClick={() => void loadPrivate()}>
                    Only you
                  </button>
                </div>
                {source === "private" && !viewer!.installed && canInstall && (
                  <p className="note">
                    To include private repositories, <a href="/api/auth/login?install=1">choose which ones readmeops may read</a>.
                  </p>
                )}
              </fieldset>
            )}

            <fieldset>
              <legend>Look</legend>
              <div className="looks" role="radiogroup" aria-label="Look">
                {LOOK_IDS.map((id) => (
                  <button key={id} type="button" role="radio" className="look" aria-checked={look === id} onClick={() => setLook(id)}>
                    <b>{LOOKS[id].name}</b>
                    <span>{LOOKS[id].description}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Preview on</legend>
              <div className="seg" role="radiogroup" aria-label="Preview theme">
                {(["dark", "light"] as const).map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={scheme === s} onClick={() => setScheme(s)}>
                    GitHub {s}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Cards</legend>
              <ul className="cards">
                {cards.map((c, i) => (
                  <li key={c.id}>
                    <label htmlFor={`card-${c.id}`}>
                      <input
                        type="checkbox"
                        id={`card-${c.id}`}
                        checked={c.on}
                        onChange={(e) => setCards((prev) => prev.map((p) => (p.id === c.id ? { ...p, on: e.target.checked } : p)))}
                      />
                      {CARD_LABELS[c.id]}
                    </label>
                    <span className="order">
                      <button type="button" aria-label={`Move ${CARD_LABELS[c.id]} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                        {"↑"}
                      </button>
                      <button type="button" aria-label={`Move ${CARD_LABELS[c.id]} down`} disabled={i === cards.length - 1} onClick={() => move(i, 1)}>
                        {"↓"}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </fieldset>

            <fieldset>
              <legend>Extras (optional)</legend>
              <label className="sub" htmlFor="headline">
                Headline
              </label>
              <input id="headline" className="text" value={headline} maxLength={80} placeholder={view.headline ?? "One line about you"} onChange={(e) => setHeadline(e.target.value)} />
              <label className="sub" htmlFor="programs">
                Programs, one per line
              </label>
              <textarea id="programs" className="text" rows={3} value={programs} placeholder={"AWS Community Builder\nLFX Mentee 2023"} onChange={(e) => setPrograms(e.target.value)} />
              <label className="sub" htmlFor="blog">
                Blog feed (RSS or Atom)
              </label>
              <input id="blog" className="text" value={blog} placeholder="https://your.blog/rss.xml" onChange={(e) => setBlog(e.target.value)} onBlur={() => void loadFeed()} />
              {feedState && <p className="note">{feedState}</p>}
            </fieldset>

            <a className="primary" href="#publish">
              Add to my profile
            </a>
          </aside>

          <div className="stage">
            {source === "private" && (
              <p className="banner" role="status">
                Only you can see this view. Your README always shows the public version.
              </p>
            )}
            <div className="gh" data-scheme={scheme}>
              <div className="gh-bar">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z" />
                </svg>
                {login}/README.md
              </div>
              <div className="gh-body" aria-busy={loading}>
                {images.length === 0 ? (
                  <p className="empty">Pick at least one card.</p>
                ) : (
                  images.map((img) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={`${img.id}-${look}-${scheme}`} src={img.uri} alt={`${CARD_LABELS[img.id]} card, ${LOOKS[look].name}`} width={840} />
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="publish" id="publish" aria-labelledby="publish-title">
          <div className="publish-head">
            <h2 id="publish-title">Add it to your profile</h2>
            <p className="muted">
              {ready
                ? `Three steps for @${login}. Everything below updates as you change the look and cards.`
                : "Load your username first, then follow these three steps."}
            </p>
          </div>
          <div className="steps">
            <div className="step">
              <div className="step-n">Step 1</div>
              <h3>Add the workflow</h3>
              {ready && !branch ? (
                <p>
                  You need the special repository named after you first.{" "}
                  <a href={`https://github.com/new?name=${encodeURIComponent(login)}&visibility=public`} target="_blank" rel="noopener noreferrer">
                    Create {login}/{login}
                  </a>{" "}
                  with a README, then come back.
                </p>
              ) : (
                <p>GitHub opens with the file filled in. Review it and commit.</p>
              )}
              <a
                className={`primary${ready && branch ? "" : " disabled"}`}
                aria-disabled={!(ready && branch)}
                href={ready && branch ? newWorkflowUrl(login, branch, yaml) : undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open GitHub with the file ready
              </a>
              <div className="codehead">
                <span>.github/workflows/readmeops.yml</span>
                <Copy text={yaml} label="workflow" />
              </div>
              <pre>{yaml}</pre>
            </div>
            <div className="step">
              <div className="step-n">Step 2</div>
              <h3>Run it once</h3>
              <p>
                In your profile repository open{" "}
                {ready ? (
                  <a href={`https://github.com/${login}/${login}/actions/workflows/readmeops.yml`} target="_blank" rel="noopener noreferrer">
                    Actions, readmeops
                  </a>
                ) : (
                  "Actions, readmeops"
                )}
                , then Run workflow. After that it refreshes every 6 hours and only pushes when a card changed.
              </p>
              <p>
                The cards go to a <code>readmeops</code> branch, so your main branch history stays clean. The job summary also
                shows the README snippet.
              </p>
            </div>
            <div className="step">
              <div className="step-n">Step 3</div>
              <h3>Paste into your README</h3>
              <p>Each card links to its proof. Upstream PRs opens GitHub&rsquo;s own search of your merged pull requests.</p>
              <div className="codehead">
                <span>README.md</span>
                <Copy text={snippet} label="README snippet" />
              </div>
              <pre>{snippet}</pre>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <span>readmeops is open source under the MIT license.</span>
        <span>Your data: public GitHub data only, unless you sign in to see your own private work.</span>
      </footer>
    </>
  );
}
