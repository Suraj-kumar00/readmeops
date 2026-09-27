<h1 align="center">readmeops</h1>

<p align="center"><b>GitHub profile cards with proof, rendered in your own repository.</b><br>
Pick a look, choose your cards, and a workflow in your profile repository keeps them fresh.
Nothing loads from a third-party server when someone views your profile.</p>

<p align="center">
<a href="https://github.com/Suraj-kumar00/readmeops/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Suraj-kumar00/readmeops/actions/workflows/ci.yml/badge.svg"></a>
</p>

## Four looks

Every look draws the same seven cards from the same numbers. Each card is a dark and a light SVG, and GitHub shows
the one that matches the viewer's theme. These previews use a fictional demo profile.

**Clean product UI** (`look: clean`, the default)

<picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Suraj-kumar00/readmeops/main/docs/looks/clean-dark.svg"><img alt="Clean product UI profile card" src="https://raw.githubusercontent.com/Suraj-kumar00/readmeops/main/docs/looks/clean-light.svg" width="100%"></picture>

**Modern terminal** (`look: terminal`)

<picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Suraj-kumar00/readmeops/main/docs/looks/terminal-dark.svg"><img alt="Modern terminal profile card" src="https://raw.githubusercontent.com/Suraj-kumar00/readmeops/main/docs/looks/terminal-light.svg" width="100%"></picture>

**Ops dashboard** (`look: ops`)

<picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Suraj-kumar00/readmeops/main/docs/looks/ops-dark.svg"><img alt="Ops dashboard profile card" src="https://raw.githubusercontent.com/Suraj-kumar00/readmeops/main/docs/looks/ops-light.svg" width="100%"></picture>

**Bold and playful** (`look: playful`)

<picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Suraj-kumar00/readmeops/main/docs/looks/playful-dark.svg"><img alt="Bold and playful profile card" src="https://raw.githubusercontent.com/Suraj-kumar00/readmeops/main/docs/looks/playful-light.svg" width="100%"></picture>

## Cards

| Card | Shows | Links to |
|---|---|---|
| `profile` | Name, headline, programs, focus topics, website | Your GitHub profile |
| `stats` | Pull requests merged upstream, stars earned, contributions, active days | Your repositories |
| `activity` | Your contributions over the last 12 months | Your GitHub profile |
| `upstream` | Pull requests merged into other people's projects, ranked by project size and PR size | GitHub's own search of those pull requests |
| `languages` | Languages by code size across your repositories | Your repositories |
| `repos` | Your top repositories by stars | Your repositories, sorted by stars |
| `writing` | Latest posts from your blog's RSS or Atom feed | Your blog |

## Add it to your profile

You need the repository named after you (`<you>/<you>`, public), which GitHub shows on your profile.

### With the editor

1. Open the readmeops editor, type your username, pick a look and your cards. The preview is your real data.
2. Click **Open GitHub with the file ready**. GitHub opens a new workflow file with everything filled in. Commit it.
3. In your profile repository open **Actions**, **readmeops**, **Run workflow**. Then paste the snippet from the
   editor into your `README.md`.

### By hand

1. Add `.github/workflows/readmeops.yml` to your profile repository:

   ```yaml
   name: readmeops
   on:
     schedule:
       - cron: "17 */6 * * *"   # every 6 hours
     workflow_dispatch:
   permissions:
     contents: write
   concurrency:
     group: readmeops
     cancel-in-progress: true
   jobs:
     cards:
       runs-on: ubuntu-latest
       timeout-minutes: 10
       steps:
         - uses: Suraj-kumar00/readmeops@v0
           with:
             look: clean
             cards: profile, stats, activity, upstream, languages
   ```

2. Run it once from the **Actions** tab.
3. Open the run. Its summary has the README snippet for your cards. Paste it into your `README.md`. Each card
   looks like this:

   ```html
   <a href="https://github.com/you"><picture>
     <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/you/you/readmeops/profile-dark.svg">
     <img alt="Profile" src="https://raw.githubusercontent.com/you/you/readmeops/profile-light.svg" width="100%">
   </picture></a>
   ```

### Workflow inputs

| Input | Default | What it does |
|---|---|---|
| `look` | `clean` | `terminal`, `clean`, `ops` or `playful` |
| `cards` | `profile, stats, activity, upstream, languages` | Cards in the order you want them, separated by commas. Add `repos` or `writing` too. |
| `headline` | First part of your GitHub bio | One line about you, up to 80 characters |
| `programs` | None | Programs, communities or certifications, one per line, up to 4 |
| `blog` | None | https URL of your blog's RSS or Atom feed, for the `writing` card |
| `user` | The repository owner | GitHub username to render |
| `token` | `${{ github.token }}` | Keep the default |
| `dry-run` | `false` | Render the cards without pushing them |

Outputs: `changed` (`"true"` when new cards were pushed) and `files` (the card file names).

## How it works

1. Every 6 hours, at a minute worked out from your username so runs are spread out, the workflow runs the readmeops
   Action in your profile repository.
2. The Action reads your public GitHub data through the GraphQL API with the workflow's own `GITHUB_TOKEN`, plus your
   blog feed if you set one.
3. It renders each card as a dark and a light SVG. The fonts are embedded, so the images need nothing else to display.
4. It pushes the files to a `readmeops` branch of your profile repository, as a single commit that replaces the
   previous one, and only when a card changed. Your main branch history stays clean.
5. Your README points at those files, and each card links to where its numbers can be checked.

## Private work

A README looks the same to everyone, so it only ever shows public data. The Action collects public data only and
refuses to publish if anything private turns up in what it collected.

To see your private work as well, sign in to the editor and switch to **Only you**. That view is built for you on the
server, never cached and never published. To include private repositories, install the editor's read-only GitHub App
on the repositories you choose.

## Security

- **View time:** your README loads images from your own repository. No third-party server sees who views your profile.
- **Workflow:** its only write permission is `contents: write`, to push the `readmeops` branch. It uses no other
  actions, and the token is masked in logs. You can pin `Suraj-kumar00/readmeops@v0` to a full commit SHA if you want
  an immutable reference.
- **Editor:** nonce-based Content Security Policy; blog feeds are fetched over https only, from public addresses,
  without following redirects and with a size cap; sessions live in an encrypted HttpOnly cookie (no database);
  sign-in uses OAuth with PKCE and state.

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## Run the editor yourself

Locally:

```bash
npm install
cp apps/editor/.env.example apps/editor/.env.local   # then set GITHUB_TOKEN
npm run dev -w @readmeops/editor
```

Without `GITHUB_TOKEN` the editor still runs, showing the demo profile only.

On Vercel:

1. Import this repository and set **Root Directory** to `apps/editor`. Keep **Include source files outside of the Root
   Directory in the Build Step** turned on (the default for new projects), because the editor uses `packages/core`.
2. Leave the build command as it is. Vercel runs the package's `build` script, which builds `packages/core` and then
   the Next.js app.
3. Set `GITHUB_TOKEN` (see [`apps/editor/.env.example`](apps/editor/.env.example)). A fine-grained personal access
   token with no permissions and no private repositories is enough, because every fine-grained token can read public
   repositories.
4. Optional, for the **Only you** view: run
   `npm run setup:github-app -w @readmeops/editor -- --name readmeops-<you> --url https://<your-site>`, then copy the
   `GITHUB_APP_*` values, `SESSION_SECRET` and `APP_URL` (your site's address, where sign-in returns) from
   `apps/editor/.env.local` into Vercel.

## Develop

```bash
npm install
npm run build:packages   # packages/core and the Action bundle
npm run typecheck
npm test
npm run looks            # regenerates docs/looks
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit and [CONTRIBUTING.md](CONTRIBUTING.md) for
the rules.

## Why this exists

Hosted card services break. As of 26 Sep 2026 the public `github-readme-stats` instance is paused
([503 DEPLOYMENT_PAUSED](https://github.com/anuraghazra/github-readme-stats/issues/4737)) and its
[repository](https://github.com/anuraghazra/github-readme-stats) is marked no longer maintained. The public
[activity graph](https://github.com/Ashutosh00710/github-readme-activity-graph) instance answered HTTP 402 the same day.
Cards that live in your own repository have no server to go down.

## Credits

The cards embed subsets of Geist and Geist Mono, JetBrains Mono, Barlow Semi Condensed and Bricolage Grotesque, all
under the SIL Open Font License 1.1 ([details](packages/core/src/fonts/LICENSE-fonts.md)).

## License

[MIT](LICENSE)
