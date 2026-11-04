# Hero slider video plays on phones

- **Date:** 2026-11-04
- **Agent:** claude
- **Branch:** `fix/hero-slider-video-mobile`
- **Area:** web
- **Type:** fix
- **Supersedes:** none

## Summary
Follow-up to the background-video fix (#217). The Hero Slider widget has its own client script, `HeroSliderClient.tsx`, with the same 768px gate, so slider videos still never played on phones (found on the live darjeelinghoney.com: video had a source but stayed paused, readyState 0). The gate is removed; Save-Data and reduced-motion visitors still keep the poster.

## Verification
- Ran: gate:quick on push. Diagnosis was on the live site in the browser pane.
- NOT verified: playback on the live site after deploy (no rebuild of page data is needed, this is client code).

## Docs updated
- [ ] ARCHITECTURE, ADR, DEPLOYMENT not needed
