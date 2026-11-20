# Believe CF-Connecting-IP only when the request came from Cloudflare

- **Date:** 2026-11-20
- **Agent:** claude
- **Branch:** `fix/client-ip-cloudflare-peer` (merged in #299, d0551ab9)
- **Area:** domain, docs
- **Type:** fix
- **Supersedes:** none

## Summary
Per-visitor rate limits (sign-in, codes, order tracking, order placement, webhooks) key on `getClientIp`. Behind Cloudflare with `TRUST_CLOUDFLARE` unset, that is a Cloudflare edge address, so many shoppers share one counter. Setting it to `true` was unsafe: a read-only check on 2026-11-20 showed the VPS answers HTTP 200 for `Host: bcom.si` without going through Cloudflare, so anyone could forge `CF-Connecting-IP`. A blanket Cloudflare-only firewall is not an option either (Coolify at `server.brandsewa.com` and the CI deploy calls reach the VPS directly on 443, and another project shares the server). So the code now checks the peer itself (audit A2-05, external SEC-001).

## What changed
- `packages/domain/src/system/cloudflare-ips.ts` (new): Cloudflare's published IPv4/IPv6 ranges (copied 2026-11-20) and `isCloudflareAddress`, built on `node:net` `BlockList`.
- `packages/domain/src/system/rate-limit.ts` `getClientIp`: with `TRUST_CLOUDFLARE=true`, `CF-Connecting-IP` is used only if the last `X-Forwarded-For` hop is a Cloudflare address and the header is a valid IP. Otherwise behaviour is unchanged (last hop, then `X-Real-IP`, then 127.0.0.1). Flag unset: no behaviour change at all.
- `packages/domain/test/client-ip.test.ts`: forged header from a direct caller is ignored, a forged earlier hop does not unlock it, IPv6 peer, malformed header, flag off, and range edge cases (23 tests).
- `DEPLOYMENT.md`, `.env.example`: `TRUST_CLOUDFLARE` text updated.

## Decisions and trade-offs
- The guarantee rests on Traefik not trusting client `X-Forwarded-For`, so the last hop is the real connecting peer. Coolify's stock Traefik does this; the visible part of the production proxy config showed no `forwardedHeaders.trustedIPs`, but the last lines were not read. Do not add trusted IPs for the internet.
- The ranges are hardcoded and need an occasional refresh. A stale range fails safe: an unknown Cloudflare address is treated as an ordinary peer, which is today's behaviour.
- The env var is only flipped after this is deployed (Coolify, `bsec-web` and `bsec-platform`); it is a separate, announced step.

## Verification
- `pnpm --filter @bs/domain exec vitest run test/client-ip.test.ts`: 23 pass. `@bs/domain` typecheck and eslint clean on the touched files.
- NOT verified: the real `X-Forwarded-For` the app sees in production (no endpoint echoes it); to be checked on staging or after deploy by watching rate-limit keys.

## Docs updated
- [x] DEPLOYMENT.md, `.env.example`; ARCHITECTURE and ADR not needed; progress.md in-flight line.

## Follow-ups and open questions
- Set `TRUST_CLOUDFLARE=true` on `bsec-web` and `bsec-platform` in Coolify after merge and deploy; check one store's sign-in and order tracking.
- The Coolify proxy page shows "configuration changed, please restart the proxy" (pending before this work); do not restart casually, it interrupts every site on the server.

## Definition of done
Gate run before push; no secrets or generated files in the diff.
