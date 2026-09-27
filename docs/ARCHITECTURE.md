# Architecture

readmeops has three parts that share one engine:

```
packages/core     data collection, the view model, the four looks, workflow and README text
packages/action   the GitHub Action: collect, render, push to the readmeops branch
apps/editor       the Next.js site: preview any profile, then add the workflow to your repository
```

Data flows one way:

```
GitHub GraphQL + RSS/Atom ─▶ ProfileData ─▶ buildView() ─▶ View ─▶ look.render(card, view, scheme) ─▶ SVG
```

`packages/core` has no runtime dependencies and runs unchanged in Node (the Action) and in the browser (the editor's
preview), so the preview is the same SVG the Action publishes.

## packages/core

| Module | Responsibility |
|---|---|
| `sources/github/client.ts` | GraphQL client with retries and timeouts. The token is only ever sent to GitHub's API. |
| `sources/github/collect.ts` | User, owned repositories, the last 365 days of contributions, pull requests merged into other people's repositories (with changed lines), and the avatar as a data URI. |
| `sources/rss.ts` | RSS 2.0, RSS 1.0 and Atom on a small XML parser that never expands DTD entities. |
| `collect.ts` | Runs the sources and returns `ProfileData`. In public mode it ends with `assertPublicSafe`. |
| `privacy.ts` | `assertPublicSafe` fails closed if public data contains anything private. Errors carry counts, never names. |
| `view.ts` | `buildView` computes everything the looks draw, once: identity, stats, weeks, months, streaks, languages by code size, upstream work grouped by repository and ranked by `log10(stars + 10) × log10(10 + changed lines)`, the 12 month timeline, repositories and posts. |
| `looks/` | `terminal`, `clean`, `ops`, `playful`. Each exports `render(card, view, scheme)` and draws all seven cards at 840px wide. |
| `fonts/` | Latin subsets of the fonts as base64 WOFF2 (`data.ts`, generated) plus real advance widths, so text is measured, truncated and wrapped before it is drawn. |
| `render/svg.ts` | The SVG document wrapper, escaping, number rounding, shared shapes and the reduced motion rule. |
| `options.ts` | Validates the workflow inputs (`look`, `cards`, `headline`, `programs`, `blog`). |
| `output.ts` | Card file names, the README snippet, card links, the workflow YAML and GitHub's prefilled new-file URL. The Action and the editor both use these, so they always agree. |
| `fixtures/demo.ts` | The fictional demo profile used by tests, the editor's sample and `docs/looks`. |

### Rules the looks follow

- Only the `View` goes in. A look never calls an API and never computes a metric, so every look shows the same
  numbers.
- The first frame is complete. Animations are ambient (a blinking cursor, a breathing peak, a spinning sticker) and
  switch off under `prefers-reduced-motion`.
- No external resources. Fonts and the avatar are embedded; nothing in the SVG points to another host.
- Text is measured with the embedded font's advance widths, then truncated or wrapped to fit.

`test/looks.test.ts` renders every card in every look and scheme with demo, empty and hostile data, and checks
well-formed XML, no active content, no external URLs, embedded fonts, reduced motion, size under 150 KB and
deterministic output.

## packages/action

`src/main.ts` reads the inputs, collects public data with the workflow's `GITHUB_TOKEN`, renders the chosen cards in
both schemes and publishes them:

1. Shallow-clone the `readmeops` branch, if it exists, and compare the card files.
2. If nothing changed, stop. Otherwise create a fresh repository with the files and one commit, and force-push it
   to `readmeops`. The branch always holds a single commit, so it never grows.
3. Write the README snippet to the job summary.

The Action is bundled with esbuild into `packages/action/dist/index.mjs` (committed, because GitHub runs it
directly). It uses Node built-ins and the `git` CLI only.

## apps/editor

A Next.js app with no database.

- `/` renders the editor. The preview calls `LOOKS[look].render` in the browser, so switching looks, cards or themes
  needs no server round trip.
- `GET /api/profile?user=` collects public data with the server's token. Responses are cached in memory and at the
  CDN for 30 minutes and rate limited per client.
- `GET /api/feed?url=` reads a blog feed through `guardedFetch`: https only, public addresses only, no redirects,
  size and time capped.
- `GET /api/me` returns the signed-in owner's data, private work included. Never cached, never published.
- `/api/auth/*` is GitHub App sign-in with OAuth, PKCE and state. The session is an AES-GCM encrypted HttpOnly cookie.
- `proxy.ts` sets a per-request nonce Content Security Policy. The editor's own fonts come from `fontFaces()` in
  core, so it loads nothing from a font host either.

## Adding a card

1. Add the id to `CARD_IDS` in `view.ts`, and any data it needs to `View` (computed in `buildView`).
2. Draw it in all four looks. The type system rejects a look that misses a card.
3. Add its alt text in `output.ts` and a link in `cardLink`.
4. Run `npm test`. The looks test covers the new card automatically.
