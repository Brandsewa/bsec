# Marketing page: agent-first redesign plan

Status: built on branch, awaiting owner review (2026-10-18). Not to be merged until the AI-commerce features it describes are built. Owner: Claude Code plans, builds and verifies. Branch `feat/marketing-agent-first`, worktree `bsec-marketing`.

## 1. Goal

Replace the "Beam" marketing page on the marketing host with the agent-first design the owner approved as a standalone HTML prototype (`bs-landing-v2.html`, kept outside the repo). Positioning: be found where people now shop, inside AI chats (ChatGPT, Gemini, Claude), with in-chat checkout supported as each assistant launches it, Indian stores first in line. The platform is global later.

## 2. Owner decisions (2026-10-18)

- **Claims:** the redesigned page ships only when the AI-commerce features it describes are built. Until then the work stays on its branch and is **not merged**. Copy may therefore describe the finished product. `apps/web/PRODUCT.md` ("only what is live today, the rest Coming soon") is superseded for this page; update it in the same change record and keep the "Coming soon" pattern available for anything still unbuilt at launch.
- The demo conversations, products, brands, ratings and the dashboard are illustrations and are labelled as such on the page.
- ChatGPT, Gemini and Claude logos are used; brand guideline review is an owner task before launch.
- Pricing cards keep reading the live `plans` table (prices and limits come from the database, never hardcoded).

## 3. What is kept, replaced, added

| Kept | Replaced (deleted once the new page is in) | Added |
|---|---|---|
| `loadLandingPlans()` and the `plans` prop; `SubdomainAvailabilityChecker` (real store-name check and `/signup` hand-off, restyled by a variant prop); `useRevealMotion`; FAQ and theme data in `landing/content.ts` (copy updated) | `beam/Orbit`, `Smoke`, `Dust`, `AppWindow`, `beam.css`; the old `MarketingLandingPage` body | `landing/` section components, `PhoneDemo` and `NegotiationDemo` (client), demo data file, brand icon SVGs, one scoped stylesheet (`.lp`), Instrument Serif via `next/font` |

## 4. Structure

```
components/marketing/
  MarketingLandingPage.tsx        composition only; receives `plans`
  landing/
    landing.css                   all rules prefixed `.lp`; tokens, aurora, bento, phone, light section
    content.ts                    copy, FAQ, themes, plan bullets (updated)
    demo-data.ts                  3 searches x 3 brands, picks, arrival text
    PhoneDemo.tsx                 client: tabs, typing, send, 3 cards, select, pay, order placed, notification
    NegotiationDemo.tsx           client: quantity slider and max-discount, scripted store replies
    BrandIcons.tsx                ChatGPT, Gemini, Claude marks (inline SVG)
    sections/                     Nav, Hero, Story (StandardsStrip, Shift), Journey, Kit (Kit, Visibility), Proof (India, Themes, Launch), Pricing, Close (SalesRep, Faq, FinalCta, Footer)
    LandingShell.tsx              client root: scopes `.lp`, loads the serif, arms reveals and the card spotlight
```
`beam/beam.css` and `beam/fonts.ts` stay because `/signup` still uses them; only the Beam hero components (Orbit, Smoke, Dust, AppWindow) were deleted.

Server components by default; client components only for the two demos, the journey tabs, the nav menu and the reveal helper.

## 5. Quality requirements (not in the prototype)

- Accessibility: visible `:focus-visible` states; real tab semantics for the assistant tabs and journey steps; a mobile menu (prototype hides links on phones); a text alternative for each animated demo (`aria-hidden` animation plus a short description); contrast checked on the cream section; one `h1`; "Log in" link in the nav.
- Performance: the grain overlay and the large blurred glows are static or reduced on small screens; demo timers run only while the demo is on screen and the tab is visible and are cleaned up on unmount; hero text renders on the server; fonts via `next/font` (no runtime request to Google).
- Motion: `prefers-reduced-motion` shows each demo's finished state.
- SEO: page metadata and a single heading hierarchy kept.

## 6. Slices

1. Worktree, fonts, scoped stylesheet tokens, Nav and Hero shell with the real store-name checker.
2. `PhoneDemo` and the standards strip.
3. Shift, Journey, Kit.
4. SalesRep (`NegotiationDemo`), Visibility, India, Themes, Launch, Pricing (live plans), FAQ, Final CTA, Footer.
5. Accessibility and performance pass; delete the Beam files; docs and change record.

## 7. Verification

- Gate: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm docs:check`, and the `@bs/web` tests.
- Tests: demo data shape (every search has three items and a valid pick); reduced-motion renders the finished state; the claim-status labels render.
- Manual: browser at 375 px, 768 px and desktop, reduced motion on and off, keyboard-only pass, Lighthouse mobile.
- Release: `main` is production. Open a pull request, owner reviews a preview, no merge while a `main` run is in progress, and no merge at all until the owner confirms the AI-commerce features are built.

## 8. Open items for the owner

- Brand guideline review for the three AI logos.
- Real product photos for the demo cards (placeholders are gradients).
- Keep the monthly and yearly pricing toggle? (prototype shows monthly only; current page has both)
- Mobile menu style.
