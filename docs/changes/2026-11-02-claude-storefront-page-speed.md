# Storefront page speed: hero image, background video, responsive images, deferred Google sign-in

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `perf/storefront-speed` (not merged yet)
- **Area:** blocks, web, domain
- **Type:** fix
- **Supersedes:** none

## Summary
A mobile PageSpeed run of a live store (darjeelinghoney.com) scored 70: layout shift 0.626, Speed Index 6.9 s, a 4.2 MB background video, 1600px images in 185px slots, media cached for 4 hours and Google's 101 KB sign-in script loaded on the home page. Most causes sit in shared storefront code, so every store benefits.

## What changed
- **Hero image:** the first background picture in a rendered block tree loads `eager` with `fetchPriority="high"`; later ones stay lazy (`RenderContext.lcpClaim`, set per `renderBlockTree` call).
- **Background video:** `BgVideo` (`packages/blocks/src/views-bg-video-client.tsx`) replaces the inline `<video autoPlay>` in Section, Container and Block. The server HTML carries only the poster; the file is attached after idle, only from 768px up, not with Data Saver or reduced motion. Phones never download it.
- **Responsive images:** `responsiveImgAttrs()` (`media-image.ts`) builds a `srcSet` from the WebP derivatives for the header and footer logo, product showcase cards, collection cards and multi-card pictures. The storefront now passes `mediaMeta` through `mediaDetailsFor()` (`BlockRenderer.tsx`, `ThemeChrome.tsx`).
- **Cache headers:** server-side `S3StorageDriver.put` (derivatives, imports) sets `Cache-Control: public, max-age=31536000, immutable`. Browser presigned uploads are unchanged (see follow-ups).
- **Google sign-in:** the prompt-only use (home, content pages) waits for page load plus idle; `initGoogleOnce` calls `google.accounts.id.initialize` once per client id (Google keeps only the last call), and the handler posts the nonce Google was initialised with.
- **Mobile buy bar:** `inert` instead of `aria-hidden`, fixing the "aria-hidden on a focused element" console warning.
- **Fonts:** `preconnect` to `fonts.googleapis.com` and `fonts.gstatic.com` when a theme loads Google fonts, plus metric-matched local fallback faces (`themeFontFallbackCss`, `FONT_FALLBACKS` in `theme-vars.ts`; same size-adjust and overrides next/font computes from Next's capsize metrics) for the 10 curated fonts, added to `--bs-font-heading` / `--bs-font-body`. The swap to the web font then does not move the page.

## Decisions and trade-offs
- Presigned PUT uploads are not changed: `Cache-Control` becomes a signed header the browser must repeat, and several clients (media queue, expenses) send only `Content-Type`. A Cloudflare cache rule covers new and existing objects instead.
- Layout shift: Lighthouse blamed the footer (content above it moving) and listed the theme web font as a cause, so the fonts get metric-matched fallbacks. Not confirmed with a new Lighthouse run; if shift remains, a local trace is the next step.
- `experimental.inlineCss` (inline the 59 KB of render-blocking CSS) was considered and left off: it is experimental and I could not check the rendered HTML here. Try it on staging.

## Verification
- Ran: `pnpm --filter @bs/blocks typecheck|lint|test` (27 files, 258 tests, includes new `test/page-speed.test.tsx`), `pnpm --filter @bs/domain typecheck`, `pnpm --filter @bs/web typecheck|lint`, `pnpm --filter @bs/admin typecheck`, `pnpm turbo run build --filter=@bs/web`, `test/perf-budget-bundle.int.test.ts` (3 pass).
- NOT verified: no browser run and no new Lighthouse run (the change is not deployed); heavy DB suites not run; `pnpm docs:check` and the full gate to be run before push.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed (no new routes, tables, jobs or env vars)
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` in-flight line

## Follow-ups and open questions
- Cloudflare cache rule for `media.bcom.si` (owner action): Edge TTL and Browser TTL one year, so existing objects stop showing a 4 hour TTL.
- Re-run PageSpeed after deploy to confirm the layout shift is gone; try `experimental.inlineCss` on staging.
- Render-blocking CSS (4 chunks, 59 KB), Cloudflare web analytics beacon, unused JS (98 KB) and contrast/tap-target flags remain.

## Definition of done
Gate partially run (see Verification); no secrets or generated files in the diff.
