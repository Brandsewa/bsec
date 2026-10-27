# One Tap on home and content pages; clearer Google setup test

- **Date:** 2026-10-27
- **Agent:** claude
- **Branch:** `feat/google-onetap-pages`
- **Area:** web, admin
- **Type:** feature
- **Supersedes:** none (amends ADR-038 on where One Tap shows)

## Summary
After the first store connected Google successfully, three follow-ups from the owner: the setup test should not be silently blocked as a pop-up, the test page should say what to do next, and One Tap should also appear on the store home page and content pages so visitors can sign in and then browse (saved addresses fill in at checkout).

## What changed
- Store Admin, Customer accounts, Google card: the test tab is opened at the click (browsers allow that) and pointed at the test page when its link is ready. A line under the button says to allow pop-ups if nothing opens, and if the browser still blocked it a yellow notice offers a plain "Open the test page" link.
- `/account/google-verify` success now says it is verified, that the tab can be closed and the owner should return to Store Admin to turn Google sign-in on, with a "Close this tab" button.
- New `GoogleOneTapPrompt` (no markup, One Tap only) on the store home page and `pages/[...path]` content pages. `GoogleSignIn` got a `button` prop.
- `GET /api/storefront/customer/google` answers disabled when a customer session exists, so signed-in visitors never see a prompt.
- The same store switch controls it ("Show One Tap on home, content and sign-in pages"); ADR-038 and ARCHITECTURE amended.

## Decisions and trade-offs
- "About us" is the store's own content page (`/pages/...`); the platform's `/about` page has no store, so Google is off there.
- One Tap is not shown on cart, checkout or product pages.
- Google's own cooldown limits how often the prompt can reappear for a visitor who dismisses it.

## Verification
- Ran: `@bs/web` and `@bs/admin` typecheck and lint, `google-button-container.test.tsx` (3 tests), `pnpm docs:check`.
- NOT verified: One Tap and the pop-up behaviour in a browser on a real store (needs deploy), other browsers' pop-up rules.

## Docs updated
- [x] ARCHITECTURE section 12, ADR-038 note; `progress.md` not needed
