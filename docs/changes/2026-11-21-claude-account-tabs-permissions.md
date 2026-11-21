# Store Account page: five tabs and a plain-language Permissions summary

- **Date:** 2026-11-21
- **Agent:** claude
- **Branch:** `feat/account-tabs-permissions` (merged in #308, 4dc5bf4d)
- **Area:** admin, domain, contracts, docs
- **Type:** feature
- **Supersedes:** none (changes the layout from `2026-11-21-claude-accounts-profile.md`)

## Summary
The store admin Account page now has five tabs with icons: Profile, Security, Notifications (the mute-able alerts moved here), Permissions (the person's own access) and Activity (security activity moved here). Presentation only; enforcement stays in the domain services.

## What changed
- `apps/admin/src/lib/access-summary.ts`: turns permission identifiers into ten grouped rows (Products & inventory, Orders & fulfilment, Refunds, Customers, Storefront & content, Payments, Shipping & taxes, Settings, Team, Analytics & exports) with Manage, View only, No access and a Sensitive access flag. It reuses `hasPermission`, so the legacy `settings.write` rule matches enforcement.
- Permissions tab: a role card (role, granted by, joined, one plain sentence, "Ask for access changes" as a mailto to the store owner), grouped rows, "Full store access" for the owner instead of a list, and a collapsed "Advanced permission details" with the raw identifiers. Loading, error-with-retry and empty states; the tab strip scrolls sideways on a phone.
- `account.get` access rows gain `owner` (name and email of the owner to ask: the one who granted the access, else the longest-standing owner; null for owners). Visible only to members of that store.
- The page only ever shows the signed-in person's own access. It never listed other staff, so nothing had to be moved; a link to Settings, Users appears for people who can manage the team.

## Verification
- Typecheck, lint, `docs:check`; new tests: 11 for the grouping helper, 5 render tests for the tab (owner, staff, advanced section, users link, loading), 3 real-database tests for the owner lookup (`account-access.int.test.ts`).
- In the browser on the local dev stack as the owner and as a seeded limited-role user: five tabs and icons, grouped rows and badges, ask link, 375 px layout (fixed an overflow found there).
- NOT verified: the ask link opening a mail client; light theme; screen reader pass (labels and badge text are real text, not colour only); CI.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (route entry, Last verified), `progress.md` In flight (remove after merge). No ADR: no architectural decision.
