# LICENSE, SECURITY.md and repository security settings

- **Date:** 2026-10-07
- **Agent:** claude
- **Branch:** `chore/license-security`
- **Area:** repo, security
- **Type:** chore

## Summary
The repository is public for the development period (owner decision 2026-10-07, to be made private again near launch). Added an explicit proprietary `LICENSE` (all rights reserved; viewable, not open source) so visibility is not mistaken for permission to reuse, and a `SECURITY.md` that points to GitHub private vulnerability reporting. Outside git, enabled on the repository: secret scanning, push protection, private vulnerability reporting and Dependabot security updates (all free on public repos).

## Verification
- Settings read back through the GitHub API after enabling; secret scanning reports 0 alerts on the existing history at the time of writing.
- Not legal advice: the `LICENSE` wording is a standard all-rights-reserved notice; have a lawyer confirm it before launch.
