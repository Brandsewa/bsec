# Blog archive and Blog post layouts in the website builder

- **Date:** 2026-11-03
- **Agent:** claude
- **Branch:** `feat/storefront-blog-templates` (not merged yet)
- **Area:** blocks, block-editor, contracts, domain, platform, superadmin
- **Type:** feature
- **Supersedes:** none

## Summary
Last part of slice S4 (`docs/MARKETING-SITE-CMS-PLAN.md` section 5a). The page switcher in Storefront > Pages > builder now lists "Blog archive" and "Blog post". Opening one that does not exist yet creates it as a draft holding the built-in layout (`marketing.pages.ensureTemplate`, the store's `ensureThemeTemplatePage`); the blog already reads the website record's template pages, so publishing one changes `/blog` and the posts.

## What changed
- Contract and handler: `marketing.pages.ensureTemplate` (keys `blog`, `blog-post`).
- Block rules by page type: the archive layout holds `BlogListing` and the generic widgets, the post layout `BlogPostContent` and the generic widgets (`isWebsiteBlogArchiveBlockSet`, `isWebsiteBlogPostBlockSet`).
- Editor page kinds `marketingBlogArchive` and `marketingBlogPost`; their settings (posts per page, layout and so on) are the store's own blog block settings.

## Verification
Real database: `apps/platform/test/marketing.int.test.ts` (17) creates both layouts, checks the starter block, accepts a heading next to the listing and refuses a website section on the post layout. Typecheck of contracts, blocks, block-editor, domain, platform and superadmin.

NOT verified: the layouts in a browser, and a published layout on the live blog (blog pages are cached per tenant; a change may take a moment to show).
