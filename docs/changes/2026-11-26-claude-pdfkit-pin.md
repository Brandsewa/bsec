# Dependency batch #342: pdfkit held at 0.20.2, 404 page off the client bundle

- **Date:** 2026-11-26
- **Agent:** claude
- **Branch:** `fix/pdfkit-bundle-pin` (follows #342)
- **Area:** domain (dependency), web (404 page, Next config), CI config (Dependabot)
- **Type:** fix

## Summary
Dependabot's minor/patch batch (#342, 50 updates) failed in three places. Two were fixed on #342 before it merged; the third showed up only in the `main` run's staging smoke test, which stopped the pipeline before production (production stayed on #341).

1. **Web build failed** with pdfkit 0.21 ("path argument ... Received an instance of URL"): pdfkit now finds its data files from its own file URL, which breaks when Next bundles it. Fixed in #342: `pdfkit` added to `serverExternalPackages` in `apps/web/next.config.ts`.
2. **Product page over its 50 KB JS budget** (50.37 KB; tailwind-merge 3.7.1). Cause: the root `not-found.tsx`, which ships with every route, rendered the client `@bs/ui` `<Button>` and so loaded Base UI, tailwind-merge and the spinner icon on every page. Fixed in #342: the 404 uses `buttonVariants` from `@bs/ui/server` on a plain button and links (same classes, no client JS). Product page 50.37 to 34.93 KB; blog pages about 15 KB lighter.
3. **Worker crashed at start** in the smoke test: `ENOENT /app/dist/data.trie` from `unicode-properties` 2 (a pdfkit 0.21 dependency). Platform and worker are esbuild single-file bundles with no `node_modules`, so data files next to a module do not exist at runtime. Fixed here: `pdfkit` pinned back to 0.20.2 (the version that ran in production), and Dependabot told to skip pdfkit 0.21+ until the images install it next to the bundle, as they do for `sharp`.

## Verification
- Worker and platform bundles copied to an empty folder and started with `node dist/main.js`: on 0.20.2 both load every module and stop at the expected "Missing env DATABASE_URL_*" check; the same test on 0.21 reproduces `ENOENT ... dist/data.trie`.
- `apps/web` production build passes; `apps/web/test/perf-budget-bundle.int.test.ts` 3/3 pass.
- Lockfile change limited to pdfkit's own dependency tree (fontkit, linebreak, unicode-properties, png-js, brotli, dfa and their deps).
- Not checked in a browser: the 404 page after the `<Button>` swap (classes are identical, and no CSS targets `data-slot="button"`). Invoice PDF rendering was not exercised.

## Open questions
- Moving to pdfkit 0.21+ needs `npm install pdfkit@<pinned>` in `infra/docker/platform.Dockerfile` and `worker.Dockerfile`, `pdfkit` added to `external` in `packages/config/build/bundle-node.js`, and a version-match check like the sharp one. Not urgent.

## Definition of done
- [x] Gate items run: build (web, worker, platform), budget test; full `gate:quick` runs on push.
- [x] No secrets, no generated files.
- [x] Honest status: see Verification.
