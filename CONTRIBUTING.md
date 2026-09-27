# Contributing

Thanks for helping. A few rules keep this project small and trustworthy:

1. **Small core.** `packages/core` has no runtime dependencies. A new one needs a strong reason.
2. **Nothing hosted in the view path.** Anything a README loads must be a file in the user's own repository.
3. **Proof over decoration.** A card should show something a reader can check, and link to where they can check it.
4. **Every card in every look.** A new card is drawn in all four looks, and `npm test` renders all of them with
   hostile input.

## Setup

```bash
npm install
npm run build:packages   # packages/core and the Action bundle
npm run typecheck
npm test
npm run dev -w @readmeops/editor
```

Node 22.18 or newer is needed: the tests run TypeScript directly.

## Fonts

The looks embed Latin subsets of OFL fonts from Fontsource. To regenerate `packages/core/src/fonts/data.ts` and its
license file:

```bash
npm i --no-save @fontsource/geist-sans@5 @fontsource/geist-mono@5 @fontsource/jetbrains-mono@5 \
  @fontsource/barlow-semi-condensed@5 @fontsource/bricolage-grotesque@5
pip install fonttools brotli
python3 scripts/subset-fonts.py node_modules/@fontsource
```

## Commits and releases

Use Conventional Commits (`feat:`, `fix:`, `docs:`...). If you change `packages/core` or `packages/action`, run
`npm run build:packages` and commit `packages/action/dist/index.mjs`; CI checks that it is up to date. If a change
affects the profile card, run `npm run looks` to refresh `docs/looks`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit and how to add a card.
