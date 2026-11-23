# Content over MCP: categories, collections, blog, website pages, menus and redirects

Status: built on `feat/ai-content-tools` (2026-11-23). Request: do for categories, collections, blog posts, website pages (text, links, sections) and the redirect manager what `docs/MCP-PRODUCTS-MAP.md` did for products. Source of truth for what exists: the admin screens and the `packages/domain` services. The AI tools are in `packages/agent-capabilities/src/capabilities/` (`categories.ts`, `collections.ts`, `blog.ts`, `pages.ts`, `menus.ts`, `redirects.ts`). Everything goes through the same domain services as the admin, so the store's own rules apply unchanged (unique slugs, depth limits, loop checks, safe-text filtering).

## 1. Permission rows (Settings > AI access > Permissions)

| Row | Read | Write | Delete | Store permission the approving user must hold |
|---|---|---|---|---|
| Categories | `get_category` (`list_categories` stays under Products read) | create, edit, show or hide | delete | products.read / products.write |
| Collections | list, get | create, edit, choose products, publish | delete | products.read / products.write |
| Blog posts (includes blog categories) | list, get | write, edit, publish, unpublish, copy | delete | content.write |
| Website pages (includes menus) | list pages, read sections, list block types, menus | edit text, links and sections, create page, publish | delete | content.write (publishing a page also needs theme.publish) |
| Redirects | list | add, edit | delete | content.write |

New rows are off for every existing store until the owner switches them on. The "Allow publishing" switch now also covers blog posts, pages and menu edits. The consent version did not change: the wording already covers "what the AI may do is what you switch on".

## 2. What "delete" means here

There is no recycle bin for these items, so deleting is permanent. The rule offered to the AI is the same everywhere:

1. The Delete cell must be on.
2. The AI must pass `confirm: true` (a vague instruction cannot delete by accident).
3. **Only an item that is already hidden from shoppers can be deleted**: an inactive category, an unpublished collection, a draft blog post, an unpublished page. To remove something live, the AI first hides it (a separate, reversible write), then deletes it.
4. The store's own rules still refuse what they always refused: a category with products or sub-categories, the home page and system pages, a page with child pages or a menu link, a menu in use, the default header and footer menus.

Redirects have no hidden state, so they only need the cell and `confirm: true`. Removing a section from a page only edits the page's draft (every earlier version stays in the page history), so it needs the Delete cell and `confirm: true` but not an unpublished page. Products keep their own rule (archive only).

## 3. Categories

| Field | Read | Add | Update | Clear | Tool |
|---|---|---|---|---|---|
| Name, slug | yes | yes | yes | n/a | `get_category`, `create_category`, `update_category` |
| Description (plain text) | yes | yes | yes | empty text | same |
| Parent category (3 levels) | yes | yes | yes | null | same |
| Image | yes (id) | yes | yes | null | same, ids from `list_media` |
| Position, featured | yes | yes | yes | | same |
| Type manual or automated, match, rules, sort order | yes | yes | yes | | same |
| Products of a manual category | first 40 | yes | replaces the list | | `productIds` (a product whose primary category this is cannot be removed) |
| SEO title and description | yes | yes | yes | | same |
| Active (visible) | yes | always created inactive | `isActive` true needs Allow publishing | `isActive` false | `update_category` |
| Delete | | | | | `delete_category` (inactive, no children, no products) |

## 4. Collections

All of the above except parent and position, plus: **indexable** (search engines), **slug**. `set_collection_products` adds, removes or replaces products of a manual collection without resending the whole list. `delete_collection` needs the collection unpublished. Rules fields: tag, product type, brand, category, price, in stock, title, with equals, not equals, contains, not contains, greater, less, is set, is not set.

## 5. Blog posts and blog categories

| Field | Tool |
|---|---|
| Title, slug (changing a live slug adds a redirect), excerpt (plain text), body HTML, featured image and alt text, blog category, author name, featured flag, SEO title and description, noindex | `create_blog_post`, `update_blog_post`, `get_blog_post` (body read in 15,000-character parts) |
| Status: always created as a draft | `publish_blog_post` (now or `publishAt` in the future = scheduled; needs Allow publishing), `unpublish_blog_post` |
| Copy | `duplicate_blog_post` (always a draft) |
| Delete | `delete_blog_post` (drafts only) |
| Blog categories (name, slug, parent, description, image, active, SEO) | `list_blog_categories`, `create_blog_category`, `update_blog_category`, `delete_blog_category` (posts move to `moveToCategoryId` or become uncategorised) |

The body is the store's own safe-text filter: simple HTML only (no scripts, styles or event handlers; images only from the media library). The result of `create_blog_post` and `get_blog_post` shows what was kept.

## 6. Website pages, text and links

A page is a list of sections ("blocks") in a validated JSON document (ADR-009, ADR-010): enumerated props, no merchant code. The AI edits the page's **draft**; the live page does not change until `publish_page`.

| What | Tool |
|---|---|
| See all pages (system pages marked by type) | `list_pages` |
| See a page and its sections as an outline (block id, type, text hint, children) | `get_page` (shows the latest draft) |
| Read one section in full (text, links, images, styles) | `get_page_block` |
| Which section types exist, and what one accepts | `list_block_types`, `describe_block_type` (platform website sections are never offered to stores) |
| Create an empty draft page, change title, address, parent, SEO | `create_page`, `update_page` |
| Change text, headings, button labels and links, or any other prop | `set_page_block_props` (only the props passed change; null removes one; links must start with /, #, https://, mailto: or tel:) |
| Add a section (with its default settings plus given props), optionally inside a Section, Container or Block | `add_page_block` |
| Reorder or nest | `move_page_block` |
| Hide or show without deleting | `set_page_block_hidden` |
| Remove from the draft | `remove_page_block` (confirm) |
| Go live or back to draft | `publish_page` (Allow publishing and theme.publish), `unpublish_page` |
| Delete a page | `delete_page` (unpublished only, not home or system pages, no child pages, not in a menu) |

Every save runs the same validation as the page builder, so a bad link, an unknown prop or too many blocks comes back as a plain sentence. Each save is a new page version, so the website builder's history can restore an earlier one.

## 7. Menus (navigation links)

`list_menus`, `get_menu`, `create_menu`, `update_menu`, `delete_menu`. An item is `title`, `url` (or empty for a heading), optional `openInNewTab` (https only), and up to two more levels of children. `update_menu` replaces the whole item list: the AI reads it with `get_menu`, changes it and sends it back with the same ids. **A menu has no draft**, so `update_menu` changes the live site at once and needs Allow publishing. Filter menus (storefront product filters) are not offered. `delete_menu` refuses the default menus and any menu in use.

## 8. Redirects

`list_redirects`, `create_redirect`, `update_redirect`, `delete_redirect`. Only paths on the store are accepted as the destination over AI access (no other websites, no `//host` forms); the store still refuses loops, reserved addresses and an address that already redirects. Status 301, 302, 307 or 308 (default 308).

## 9. Safeguards that apply to everything above

Every change is recorded in the audit log as made by the AI app with the values before and after; writes count against the daily and per-minute write limits; text fields refuse HTML except the blog body (which is filtered); a duplicate slug, a missing id and a store rule that blocks the change each come back as a plain sentence.

## 10. Not covered

Uploading images (use the media library), product reviews, theme settings and the site header and footer layout beyond editing their blocks, filter menus, bulk edit in one call, importing redirects in bulk, restoring an old page version (the website builder does that), blog comments, and permanent deletion of anything that is live.
