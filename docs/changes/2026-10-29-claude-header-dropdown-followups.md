# Follow-ups to the storefront batch: header background, dropdowns, TOC, reviews image

- **Date:** 2026-10-29
- **Agent:** claude
- **Branch:** `fix/header-bg-dropdown-followups` (not merged yet)
- **Area:** blocks, block-editor, web
- **Type:** fix
- **Supersedes:** none

## Summary
The previous batch (#152) made the default block tone transparent, which also made the site header transparent (a regression). This fixes that, the dropdown spacing and the dropdown that stayed open after a click, closes the blog table of contents by default, and adds an image option to the Floating reviews widget.

## What changed
- **Header and footer background.** `.bsb-site-header.bsb-tone-default` and `.bs-block-site-footer.bsb-tone-default` paint `var(--bg)` again; the other tones (surface, primary, dark) were never affected. Ordinary blocks stay transparent.
- **Dropdown position.** The menu sits 1.1rem below the header's bottom line; a `::before` strip bridges the gap so the hover is not lost on the way down.
- **Dropdown closes after a click.** New client component `NavDropdownCloser` (`views-mobile-menu-client.tsx`, rendered by the header when it has a menu) adds `bsb-dd-closed` to an item after a click inside its menu and removes it when the pointer or focus moves elsewhere. Needed because a client-side page change keeps the header and the pointer in place, so `:hover` kept the menu open.
- **Blog table of contents** (`PostMobileToc.tsx`): closed by default on phones; the bottom bar after scrolling is unchanged.
- **Floating reviews image.** New props `imageMediaId`, `imageAlt`, `imagePlace` (below or above the text). The picture fills the column height left under the buttons on desktop and uses a 16:10 shape on phones. Editor fields are in the "Heading and layout" group. Existing widgets are unchanged (no picture by default); no block version bump.

## Decisions and trade-offs
- "Above" and "below" are relative to the eyebrow, title, description and buttons.
- Gallery "Lookbook" heading on other pages: not changed. A new Gallery has no sample heading and an empty one draws nothing on the storefront (since #148); the report could not be reproduced from the code. Waiting for the owner to say which page and where in the outline it sits.

## Verification
- Ran: typecheck, lint, build, docs:check, blocks, web, block-editor tests (see below for results).
- NOT verified: nothing viewed in a browser; the dropdown close behaviour and the header colour are checked by reading and by the render tests, not by clicking.

## Docs updated
- [x] `docs/ARCHITECTURE.md`: not needed (no structure, route, table or env change)
- [x] ADR: not needed
- [x] `progress.md`: in-flight line added, previous line removed

## Follow-ups and open questions
- Gallery "Lookbook" heading: need the page and the block's position in the outline.

## Definition of done
Gate passes; test added for the reviews image; no secrets or generated files in the diff.
