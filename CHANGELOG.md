# Changelog

## 0.1.0 (unreleased)

First release.

- Four looks (Modern terminal, Clean product UI, Ops dashboard, Bold and playful), each drawing seven cards:
  profile, stats, activity, upstream, languages, repos and writing. Every card ships in dark and light.
- Embedded font subsets and measured text, so cards render the same everywhere and load nothing from other hosts.
- Upstream pull requests ranked by project size and PR size, linked to GitHub's own search as proof.
- GitHub Action (`node24`): settings are workflow inputs with defaults; cards are published to a `readmeops` branch
  as a single commit, only when something changed.
- Public builds fail closed if anything private appears in the collected data.
- Editor (Next.js): preview any public profile in every look, then add the workflow to your repository with a
  prefilled GitHub link. Optional GitHub App sign-in for an owner-only view of private work.
