# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately with GitHub's **Report a vulnerability** button on the Security tab of this
repository. Do not open a public issue. You will get an acknowledgement within 72 hours.

## Scope

- `packages/core` and `packages/action`: the code that runs in your workflow
- `apps/editor`: the web editor, including sign-in and the owner-only view

## Design commitments

- A published card never contains private data. The Action collects public data only and refuses to publish if
  anything private turns up. Its errors report counts, never names.
- Tokens are sent only to GitHub's API, are masked in workflow logs and are never stored in a database.
- The workflow's only write permission is `contents: write`, used to push the `readmeops` branch. It uses no other
  actions.
- Cards load nothing from other hosts: fonts and avatars are embedded, and scripts and external references are
  rejected by the tests.
- The editor keeps sessions in an encrypted HttpOnly cookie, uses PKCE and state for OAuth, applies a nonce-based
  Content Security Policy, and fetches blog feeds over https only, from public addresses, without redirects and with
  a size cap.
- CI fails on any known vulnerability reported by `npm audit`. CodeQL and Dependabot run on this repository, and the
  actions used in CI are pinned to full commit SHAs.

## Supported versions

The latest release receives security fixes.
