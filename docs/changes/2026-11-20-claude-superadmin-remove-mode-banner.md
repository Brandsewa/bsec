# Remove the Super Admin mode banner

- **Date:** 2026-11-20
- **Agent:** claude
- **Branch:** `fix/superadmin-remove-mode-banner`  (not merged yet)
- **Area:** superadmin
- **Type:** removal
- **Supersedes:** none

## Summary
Ruttl ticket "Remove this header Notice" (filed from superadmin.bcom.si): the amber bar across the top of Super Admin ("Super Admin Mode · Every privileged action is audited under platform BYPASSRLS", plus the staff email and role) is removed.

## What changed
- `apps/superadmin/src/pages/Layout.tsx`: the `banner` prop on `AppShell` is gone (the prop is optional). Nothing else used it.

## Decisions and trade-offs
- Removed outright, as the ticket says. The audit behaviour is unchanged (every platform mutation still writes `platform_audit_logs`); only the on-screen reminder is gone. The signed-in staff email and name remain in the user menu.
- Owner asked for removal over replacing it with a badge ("proceed ahead with both").

## Verification
- Ran: `pnpm gate:quick` via the pre-push hook (see PR for CI).
- NOT verified: not viewed in a browser.

## Docs updated
- [ ] `docs/ARCHITECTURE.md`: not needed
- [ ] ADR: not needed
- [ ] `DEPLOYMENT.md`: not needed
- [ ] `progress.md`: in-flight line added, removed at merge

## Follow-ups and open questions
- None.

## Definition of done
Gate run before push; no secrets or generated files in the diff.
