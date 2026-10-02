# Coolify deployment runbook

**Status:** production is live on the shared Brand Sewa VPS (`server.brandsewa.com`, host IP `88.222.241.159`), Coolify project **Bs Commerce Platform** -> environment `production`. There is **no staging VPS**; staging is an ephemeral CI stack, see section 0. Everything below reflects what is actually configured, not just the plan.

Images are built by GitHub Actions and pulled from GHCR (`ghcr.io/brandsewa/bsec-*`, all **public** -- no registry credentials needed on the VPS). **Nothing is built on the VPS.** Source: PLAN section 3, section 13 (M0), section 14.

| Resource (Coolify name) | UUID | Role | DB credentials | Port | Domain |
|---|---|---|---|---|---|
| `bsec-postgres` | `jpukpasrsnmzzt6w2gshxktd` | Postgres 18, internal-only | superuser (Coolify-generated) | 5432 | none |
| `bsec-migrate` | `qqqlm48eqo7f8pnfwn766suc` | one-shot, before every deploy | `app_owner` (+ superuser, first run only) | - | none |
| `bsec-web` | `7wuzc3xhtzhxud3315pjutnd` | storefront, marketing, Store API | `app_rw` | 3000 | `gobs.cloud`, `www.gobs.cloud` |
| `bsec-platform` | `w4awz0y3fxzxtwstps1srgfi` | Platform API | `app_platform` (BYPASSRLS) | 4000 | `platform.gobs.cloud` |
| `bsec-worker` | `ecfwkdh7citlanfto6gpgqdv` | pg-boss consumers | `app_rw` | 4100 | none |
| `bsec-admin` | `miz7k30kdqjwmqgiru4k9xtz` | static SPA (nginx) | none | 8080 | `admin.gobs.cloud` |
| `bsec-superadmin` | `mvpbrx2k9jp3q1invu8ayk48` | static SPA (nginx), prebuilt image | none | 8081 | `superadmin.gobs.cloud` |

---

## 0. Staging - CI-based ephemeral stack (no staging VPS)
Decided 2026-09-29: a persistent staging VPS isn't worth the cost yet. Instead, every push to `main` runs the exact images `images` just pushed on the GitHub Actions runner, smoke-tests them, and tears the stack down. `deploy-production` has `needs: [images, staging-smoke-test]`, so a failing smoke test blocks the production deploy.
- Definition: `docker-compose.staging.yml` (same 6-service topology as production; `image:` only, no `build:`; every password is a required variable) and the `staging-smoke-test` job in `ci.yml`. Local dev stays in `docker-compose.yml`.
- Image tag: `sha-<full sha>` (docker/metadata-action `type=sha` prefixes `sha-`; a bare `<sha>` tag does not exist and gives `manifest unknown`).
- Secrets: `openssl rand -hex 16` per run, masked in logs. Production credentials are never used.
- Steps: `pull` -> `up -d --wait` -> assert `migrate` exit code 0 -> curl `/health` on web (`/api/health`), platform, worker, admin, asserting `status: ok` and `db.ok`/`db.role` (`app_rw`, `app_platform`, `app_rw`) -> `down -v` under `if: always()`.
- TODO (M5 exit criterion): extend the smoke test to place a real COD test order against the running stack, so the order lifecycle is proven "on staging".
- Limits: it is not a persistent environment (no manual QA, no data carried between runs, no Coolify-level deploy rehearsal). Revisit a real staging VPS if those become needed; the steps would be sections 1-5 on a new host plus a `deploy-staging` job.
- **Verified for real (2026-09-29):** CI run 36536841168 on `main` (commit 128d86a) was green end to end. The staging job took 39s, `migrate exit code: 0`, and the four `/health` responses reported the run's commit SHA with the correct roles. Teardown removed all six containers, the `bsec_pgdata` volume and the network, and `ps -a` afterwards was empty. `deploy-production` ran only after it. Earlier attempts caught the `sha-` tag bug above.

## 1. Server preparation
Already done on the production VPS (shared with other Brand Sewa projects). For a **new** VPS (e.g. the future staging one), as root on a fresh Ubuntu 24.04 install:
```bash
apt update && apt -y full-upgrade && apt -y install ufw fail2ban unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl reload ssh
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
```
Docker publishes ports by writing iptables rules that bypass ufw. **Never publish the Postgres port.** `bsec-postgres` has no port mapping - confirmed (Public access: none).

## 2. Coolify
Already running on the production VPS. API access is **enabled** (Settings -> Advanced -> API and MCP), needed for CI deploys (section 6). `Allowed API IPs` is currently unrestricted - GitHub Actions runner IPs are dynamic, so this is guarded by the bearer token instead; tighten later if Coolify supports IP ranges well enough to be worth it.

## 3. Postgres
`bsec-postgres`: image `postgres:18`, database `bsec`, not publicly exposed. Running on default memory settings - **not** the plan's 1.5 GB `shared_buffers` tuning, because this VPS is shared with other projects (Bs Ecommerce, Discover Darjeeling, Ricwell, Santuals) and there's no room to reserve that much just for this database yet. Revisit sizing once this platform is the primary tenant of the box or moves to its own server.

## 4. Roles bootstrap
Done via the `bsec-migrate` resource's single `deploy.js` entrypoint (`packages/db/src/scripts/deploy.ts`), **not** a manual `docker run` - that needs no VPS shell access at all:
1. Create `bsec-migrate` as a Coolify "Docker Image" resource, image `ghcr.io/brandsewa/bsec-migrate:main`.
2. Set env vars (once, for the first run): `DATABASE_URL_SUPERUSER` (copy from `bsec-postgres` -> General -> "Postgres URL (internal)"), `APP_OWNER_PASSWORD`, `APP_RW_PASSWORD`, `APP_PLATFORM_PASSWORD` and (for self-service signup/billing) `APP_SAAS_PASSWORD` (generate strong random values); then add `DATABASE_URL_SAAS=postgres://app_saas:<APP_SAAS_PASSWORD>@<postgres-internal-hostname>:5432/bsec` to web and worker, `DATABASE_URL_OWNER` (same host, `app_owner` + its password).
3. Click **Deploy**. Check Runtime Logs for `roles ok` / `migrations ok`.
4. **Remove `DATABASE_URL_SUPERUSER`** from the resource's env vars afterwards - only this one-shot job may ever hold superuser credentials, and it only needs it once. `deploy.js` skips the bootstrap step (just migrates) when that var is absent.
5. Coolify's default restart policy will loop-restart a Docker Image resource whose process exits 0 (as `deploy.js` always does). After a successful deploy, go to Actions -> Stop so it sits idle until the next deploy, instead of restarting forever.

## 5. Applications
One Coolify "Docker Image" resource per image (see the table above for images/ports/domains). For each:
- **Networking -> Ports exposes**: set to the app's port. This field has been flaky on this Coolify install - after Save, **reload the page and confirm it stuck** before moving on; it silently reverted to `80` twice during setup. Every app also sets `PORT` (and web additionally `HOSTNAME=0.0.0.0`) explicitly as an env var as a defensive backstop, since Coolify injects its own `PORT` matching Exposed Ports and that's what actually decided which port the process bound to in testing.
- **Healthcheck**: leave **disabled**. Coolify's own HTTP healthcheck on this server fails with `wget: can't connect to remote host: Connection refused` even when the app is demonstrably up - its check appears to run outside the app container's network namespace. Verify liveness via the app's own `/health` endpoint from outside instead (see section 6 verification). Root-cause and re-enable later if it matters for rolling-update gating.
- **Environment variables** (Developer view, paste as a block):

| Resource | Env vars |
|---|---|
| web | `DATABASE_URL_RW=postgres://app_rw:...@<postgres-internal-hostname>:5432/bsec`, `APP_ENV=production`, `DB_POOL_MAX=10`, `LOG_LEVEL=info`, `PORT=3000`, `HOSTNAME=0.0.0.0`, `TENANT_SECRETS_KEY=<32-byte-hex-or-string>` |
| platform | `DATABASE_URL_PLATFORM=postgres://app_platform:...@<postgres-internal-hostname>:5432/bsec`, `APP_ENV=production`, `DB_POOL_MAX=3`, `LOG_LEVEL=info`, `PORT=4000`, `TENANT_SECRETS_KEY=<32-byte-hex-or-string>` |
| worker | `DATABASE_URL_RW=postgres://app_rw:...@<postgres-internal-hostname>:5432/bsec`, `WORKER_CONCURRENCY=4`, `APP_ENV=production`, `LOG_LEVEL=info`, `PORT=4100`, `TENANT_SECRETS_KEY=<32-byte-hex-or-string>` |
| admin | none (static nginx SPA; build-arg VITE_SENTRY_DSN optional) |

`<postgres-internal-hostname>` is `bsec-postgres`'s Coolify-assigned container hostname (visible on its General page, "Postgres URL (internal)") - same Docker network (`coolify`), reachable by name.

**Checklist (security):** `DATABASE_URL_PLATFORM` exists **only** on `bsec-platform`. `DATABASE_URL_OWNER`/`APP_*_PASSWORD` exist **only** on `bsec-migrate`, and its `DATABASE_URL_SUPERUSER` is removed after the first run (section 4, step 4).

### Domains
- `gobs.cloud` / `www.gobs.cloud` -> `bsec-web`. **Live.** (Previously served the old single-store app; that Coolify project has been deleted.)
- `admin.gobs.cloud` -> `bsec-admin`. **Live.** No `www.` variant (not needed for an admin/API subdomain).
- `platform.gobs.cloud` -> `bsec-platform`. **Live.** No `www.` variant. Note PLAN section 14 wants the platform API behind Cloudflare Access or otherwise non-public - right now it's a public HTTPS endpoint requiring platform_staff auth at the application layer only (which doesn't exist yet - M1). Don't point real traffic at it until that's decided; consider adding Cloudflare Access in front of it.
- **Gotcha (2026-09-28):** when `admin.gobs.cloud` was first added through Coolify's "Add Domain" dialog, a pre-filled/stale value in the input wasn't cleared before typing, so the saved value became the literal string `admin.gobs.cloudadmin.gobs.cloud` - Traefik had no router for the real hostname, giving a 503 until it was caught (from a screenshot) and fixed. Always reload and re-read a freshly-typed domain value in this UI before trusting it. The auto-added `www.admin.gobs.cloud` / `www.platform.gobs.cloud` entries were also removed as unneeded. While cleaning those up, `bsec-platform`'s auto-generated `sslip.io` fallback domain was accidentally deleted too (stale UI element reference) - harmless, it was only a diagnostic convenience.
- `bsec-worker`: no domain (internal only; its `/health` is reachable over the `coolify` network, not the public internet).

### Resource limits
Not yet set (PLAN section 14 target: web 800 MB / platform 200 MB / worker 400 MB / admin 64 MB / Postgres 2 GB). Low priority until this VPS is under real load - see section 3 on shared-tenancy sizing.

## 6. Deploy flow (as actually wired)
CI (`.github/workflows/ci.yml`) on every push to `main` (and on PRs):
1. Parallel check stage (both required, gating the build):
   - `check-fast`: `pnpm typecheck`, `pnpm lint`, `pnpm build` (generates `.next` for perf budget check), and `pnpm test:fast` (all unit tests across all packages and apps without DB).
   - `check-heavy`: runs `pnpm test:heavy` against a real Postgres 18 service container (`roles.int.test.ts`, concurrency proofs for number sequences and inventory reservations, webhook inbox HMAC verification, and 247+16 isolation suites with `fileParallelism: false` and advisory lock protection).
2. `images`: build + push all 5 images to GHCR, tags `:sha-<sha>` and `:main` (strictly depends on `[check-fast, check-heavy]`; skipped if either check fails).
3. `staging-smoke-test`: ephemeral compose stack running the images just pushed, testing migrate exit code and /health endpoints.
4. `deploy-production` (gated by `[images, staging-smoke-test]`, and by the GitHub `production` environment - **see the approval caveat below**):
   - `POST https://server.brandsewa.com/api/v1/deploy?uuid=qqqlm48eqo7f8pnfwn766suc&force=false` - redeploys `bsec-migrate`, which pulls `:main` and runs `deploy.js` (bootstrap-if-superuser-set, then always migrate).
   - `sleep 45` - no read-scoped token to poll deployment status, so this is a fixed wait. Migrate has taken ~15-20s in practice; 45s is headroom, not a guarantee. If a migration ever takes longer (a big backfill, say), this needs a real poll loop instead.
   - `POST .../api/v1/deploy?uuid=<web>,<platform>,<worker>,<admin>&force=false` - Coolify accepts comma-separated UUIDs in one call and redeploys all four.
5. Auth: `COOLIFY_TOKEN`, a Coolify API token scoped to **Deploy only** (Keys & Tokens -> API Tokens), 1-year expiry, stored as a secret on the GitHub `production` environment. It cannot read deployment status or anything else - least privilege. **Rotate before it expires** (create a new token, update the GitHub secret, revoke the old one in Coolify).

**Approval gate caveat:** GitHub's required-reviewers protection rule on the `production` environment needs a paid plan for a private repo - attempting to set it returned a 422 ("Please ensure the billing plan supports the required reviewers protection rule"). Until the repo goes public or the org upgrades, **every push to `main` that passes CI deploys straight to production with no human approval step**, despite what the workflow's comments say. Either upgrade the plan, make the repo public, or add a manual `workflow_dispatch` gate if that risk needs closing sooner.

**Verified for real (2026-09-28):** a genuine push to `main` (adding this workflow change itself) ran the whole pipeline end to end - typecheck/lint/test, build+push all 5 images, migrate, then redeploy all four apps via the Coolify API - and finished green (`gh run view`, all jobs succeeded). `gobs.cloud/api/health` afterwards reported the exact commit SHA that triggered the run, confirming the new build actually landed.

### Manual deploy (without CI)
```bash
curl -X POST "https://server.brandsewa.com/api/v1/deploy?uuid=<resource-uuid>[,<uuid2>,...]&force=false" \
  -H "Authorization: Bearer <COOLIFY_TOKEN>"
```

### Verification after any deploy
```bash
curl -s https://gobs.cloud/api/health          # web
curl -s https://platform.gobs.cloud/health     # platform
curl -s https://admin.gobs.cloud/health        # admin
# worker has no public URL; check Coolify -> bsec-worker -> Runtime Logs for "worker started"
```
Each app's `/health` returns `{"status":"ok","service":"...","db":{"ok":true,"role":"..."}}` (admin has no `db` field - it's static). Confirm `role` matches the table above (`app_rw` for web/worker, `app_platform` for platform) - a mismatch means the wrong `DATABASE_URL_*` landed on the wrong resource.

## 7. Rollback
- App: in Coolify, redeploy the previous `:<sha>` tag for the affected resource(s) (Container Image -> Tag, or via the API with an explicit tag). Schema stays compatible thanks to expand/contract (`docs/migrations.md`).
- Never hand-edit the schema in production. Write a forward migration.
- Data: restore from a `bsec-postgres` backup (section 8).

## 8. Backups
**Using Coolify's native scheduled `pg_dump` backups**, not pgBackRest (`infra/backups/` is now superseded by this for the current stage - simpler, and needs no VPS shell access). Configured on `bsec-postgres` -> Backups:
- Schedule: daily, cron `30 2 * * *` (02:30 UTC), database `bsec`, timeout 3600s.
- Local retention: 14 backups / 14 days / 5 GB cap.
- Offsite: Cloudflare R2, bucket `bsec-backups` (Standard class, Asia-Pacific auto location). S3 storage destination `bsec-backups-r2` added in Coolify (Settings -> S3 Storage), endpoint `https://7a0533854a8ded58696db809f403f26c.r2.cloudflarestorage.com`, region `auto`, credentials from a Cloudflare Account API Token scoped **only** to this bucket (Object Read & Write) - same pattern as the account's other per-project R2 tokens. Attached to `bsec-postgres`'s schedule with "Keep local backup" also on, so both copies exist.
- Verified for real (2026-09-28): ran "Back Up Now" -> `Success`, execution shows both `Local Available` and `S3 Available`; confirmed in the Cloudflare R2 dashboard that real objects exist under `bsec-backups/data/` with non-zero Class A/B operations counters.
- Not yet done: a restore drill (pull an object back from R2, restore into a scratch Postgres, log RPO/RTO) and an S3-side lifecycle/retention policy in R2 (local retention is 14 backups/14 days/5 GB; R2 currently has no separate expiry, so it will grow unbounded until one is added).

## 9. Observability
- Sentry: one project per service (`web`, `platform`, `worker`), `SENTRY_DSN` per resource. Code no-ops when unset - **not configured yet**, no DSNs set.
- Logs: pino JSON on stdout with `request_id` (`tenant_id` populated from M1). Not yet shipped anywhere durable - only visible via Coolify's Runtime Logs, which don't persist long. Better Stack log drain still to do.
- Uptime: not set up yet. Once it is: `https://gobs.cloud/api/health`, `https://admin.gobs.cloud/health`, `https://platform.gobs.cloud/health`.

## 10. Gotchas (specific to this VPS/Coolify install, learned the hard way)
- Only publish Postgres on the internal network; ufw does not protect Docker-published ports.
- `app_platform` has BYPASSRLS: treat its password like a superuser's.
- Coolify's per-resource HTTP healthcheck doesn't work here (section 5) - leave it disabled, verify externally.
- The "Exposed ports" field on a resource's General page can silently revert after save+reload; the dedicated Networking sidebar page is reliable. Always set `PORT` as an explicit env var too.
- A Docker Image resource whose process exits 0 (like `bsec-migrate`) gets restarted in a loop by Coolify's default policy - **Stop it manually** after a successful one-shot run.
- Deploying via the API needs `POST`, not `GET` (a `GET` on `/api/v1/deploy` returns a 405 telling you so).
- Keep the VPS free of build tools; if a build is needed, it belongs in GitHub Actions.
