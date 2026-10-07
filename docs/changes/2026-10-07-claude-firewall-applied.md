# VPS firewall applied (record)

- **Date:** 2026-10-07
- **Agent:** claude
- **Branch:** `docs/firewall-applied`
- **Area:** docs, infra
- **Type:** docs

## Summary
The owner added accept rules for TCP 22, 80 and 443 to the Hostinger VPS firewall and attached it to the server. Recorded the result in `infra/coolify/RUNBOOK.md` section 9 and `progress.md`. Nothing in the repository's code changed.

## Verification
- Before attaching: a TCP probe showed 22, 80, 443, 8000, 6001, 6002 open on the IPv4 address (the firewall was created but not attached).
- After attaching: the same probe showed only 22, 80 and 443 open on both the IPv4 and IPv6 address; 8000, 6001 and 6002 were closed. The admin, storefront and Coolify URLs still answered (200/200/302) and the Coolify dashboard loaded with no console errors.
- Not verified: that a full deploy from CI still works end to end after the change (it only needs port 443); the next pipeline run on `main` is that test.
