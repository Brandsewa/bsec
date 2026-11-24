# Tabs revisions: custom field picker, four-box paddings, accordion icon size, no default padding

- **Date:** 2026-11-24
- **Agent:** claude
- **Branch:** `feat/tabs-revisions-custom-fields`  (not merged yet)
- **Area:** blocks, block-editor, web, admin
- **Type:** feature
- **Supersedes:** none

## Summary
Owner feedback on the Tabs widget after testing it live (#321): the Content box was crowded, custom field keys had to be copied and pasted by hand, paddings were two boxes, the accordion icon had no size, and the widget carried its own top and bottom padding.

## What changed
- **Custom field picker.** A "{ } Custom field" button in the Content toolbar of a tab opens a small popup listing the store's active product custom fields (name, key, type; search when there are many). Choosing one writes `{{field:key}}` on its own line at the cursor. On the product page that token is replaced by the product's value (`ctx.renderCustomFieldValue` in `products/[slug]/page.tsx`, using `customFieldBody`, no wrapper or padding); a product without a value shows nothing. In the editor and previews the token shows as a labelled sample.
- **Product accordion.** The "Custom field key" text box in the product page's accordion rows is now the same popup (`customFieldKeyField`): shows the chosen field's name and key, with Clear. Same stored `fieldKey`.
- **Preview removed** from the Tabs Content field (the canvas already shows the result). The Text block keeps its preview (`markdownTextField(label, { preview, customFields })`).
- **Four-box paddings** (top, right, bottom, left, px, 0 to 96) for the tab titles and for the content area (`titlePadding`, `bodyPadding`, `PxQuadField.tsx`). A side left empty falls back to the older two values (`titlePaddingX/Y`, `bodyPaddingX/Y`), so saved blocks look the same.
- **Accordion icon size** (8 to 32 px, default 12) under "On phones".
- **No default padding.** The widget no longer has the section's top and bottom padding or its own width wrapper and side padding; the Width option is gone from the panel (the stored value is ignored). Space and size it with a Section or Container.
- Host API: `BlockEditorHost.listCustomFields` (store admin implements it with `admin.customFields.listDefinitions`, product fields that are active and shown on the storefront; the Super Admin host has none, so the popup says custom fields belong to a store).

## Decisions and trade-offs
- Only product custom fields are offered: values are drawn only on the product page today (collection custom fields have no storefront renderer).
- A field token inside a sentence puts the value on its own line; the editor inserts it on its own line for that reason.
- The schema change is additive (new optional fields with defaults), so the block stays at version 1 (ADR-009).

## Verification
- Ran: `pnpm --filter @bs/blocks exec vitest run` 313 pass (new cases: no padding, four-side padding and fallback, field token live and sample, icon size); `pnpm --filter @bs/block-editor exec vitest run` 41 pass; typecheck of blocks, block-editor and admin; `pnpm lint`.
- NOT verified: the popup, the picker button and the four boxes were not driven in a browser (the owner login needs a two-step code), and the product page was not loaded with a real field value. `pnpm build` and the heavy tests were not run locally.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (Tabs entry)
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md` (in flight)

## Follow-ups and open questions
- Collection custom fields have no storefront rendering; say if the collection page should get them.

## Definition of done
Gate partly run (see Verification). No secrets or generated files in the diff.
