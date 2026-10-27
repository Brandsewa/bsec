# Let an owner who signed up with email and password sign in with Google

- **Date:** 2026-10-24
- **Agent:** claude
- **Branch:** `fix/google-link-unverified-owner` (merged in #117; branch deleted)
- **Area:** auth, admin, superadmin
- **Type:** fix
- **Supersedes:** none

## Summary
An owner who had signed up with email and password could not use "Continue with Google" with the same email: Better Auth refused to link because owners who sign up with email are saved with `emailVerified = false`, and linking required a verified local email. The login then showed a generic failure.

## What changed
- Google linking no longer needs the local email to be verified (`requireLocalEmailVerified: false`); Google must still confirm the email.
- New `googleAccountLinkGuard` (`packages/auth/src/google.ts`, wired on the staff and platform instances) runs before a Google account is linked during a Google sign-in. If the user's own email was never verified, it deletes their password login and all their sessions and marks the email verified. This closes the pre-registration takeover (someone registers the victim's address with their own password, the victim later signs in with Google). A user with a verified email is untouched.
- Admin and Super Admin login pages show what went wrong (no account for that email, could not link, or the error code) instead of one generic line.

## Decisions and trade-offs
- Automatic linking is the standard when the provider confirms the email; the guard keeps it safe. Cost: an owner who signed up with a password and then signs in with Google must use "Forgot password" to set a password again.
- No "Connected accounts" page was added; explicit linking while signed in would avoid the password reset but is a larger change.
- ADR-038 amended.

## Verification
- `packages/auth` 15 pass; `platform-auth-providers.int.test.ts` 19 pass (3 new: unverified account is cleaned and verified, verified account untouched, other providers and non-Google paths ignored). Typecheck and lint pass for auth, domain, admin, superadmin.
- NOT verified: the full Google redirect and link against a real Google client. The guard is tested directly, not through Better Auth's callback.

## Docs updated
- [x] `docs/ARCHITECTURE.md` (section 12)
- [x] ADR-038 amended
- [x] `DEPLOYMENT.md` / RUNBOOK: not needed
- [x] `progress.md`: not needed
