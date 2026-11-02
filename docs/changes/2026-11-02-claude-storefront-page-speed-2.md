# Storefront page speed, round 2: footer layout shift, hero slider video on phones, responsive section backgrounds

- **Date:** 2026-11-02
- **Agent:** claude
- **Branch:** `perf/storefront-speed-2` (not merged yet)
- **Area:** web, blocks
- **Type:** fix
- **Supersedes:** none

## Summary
The PageSpeed re-run after #197 (score 70 to 72, Speed Index 6.9 s to 5.1 s, media cache warning gone, logo and cards now use derivatives) still showed layout shift 0.626 and a 4.2 MB video on mobile. The report's LCP element was the footer text: the route's loading skeleton is only about 200px tall, so on block-built pages the footer is on screen at first paint and the streamed page then pushes it down.

## What changed
- `globals.css`: `main:has(.store-skeleton, [aria-busy="true"]) { min-height: 100dvh }` so a loading route fills the first screen and the footer starts below the fold.
- `HeroSliderClient`: slide videos play only from 768px up and not with Data Saver or reduced motion (also for a one-slide hero); the server HTML no longer asks for `preload="metadata"` on the first slide. Phones keep the poster. The 4.2 MB clip came from the hero slider, not the Section background that #197 covered.
- `SectionView`, `ContainerView`, `BlockView`: an uploaded background picture gets a `srcSet` from its derivatives (`sizes="100vw"`); a pasted image URL is unchanged.

## Decisions and trade-offs
- The skeleton fix is CSS, not edits to 48 `loading.tsx` files. Any `main` containing a `.store-skeleton` or `aria-busy` skeleton is a full screen tall while loading.
- Render-blocking CSS (59 KB, est. 730 ms to 1.6 s on slow 4G) is still open; `experimental.inlineCss` needs a staging check.

## Verification
- Ran: `@bs/blocks` typecheck, lint, 261 tests (2 new); `@bs/web` typecheck and lint (0 errors).
- NOT verified: not seen in a browser and not re-measured; the footer shift is a diagnosis from the report, to be confirmed by the next PageSpeed run after deploy.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed
- [ ] ADR / DEPLOYMENT: not needed
- [x] `progress.md` in-flight line

## Follow-ups and open questions
- Re-run PageSpeed after deploy; try `experimental.inlineCss` on staging; Google sign-in script (101 KB) still loads after load on the home page.

## Definition of done
Gate to be run on push; no secrets or generated files in the diff.
