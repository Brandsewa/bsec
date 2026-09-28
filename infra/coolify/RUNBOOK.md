# Coolify deployment runbook

Applies to **staging** (small VPS, 2 vCPU / 4 GB) and **production** (2 vCPU / 8 GB), both Ubuntu 24.04 + Coolify. Images are built by GitHub Actions and pulled from GHCR. **Nothing is built on a VPS.** Source: PLAN §3, §13 (M0), §14.

Images (`ghcr.io/brandsewa/…`, tags `:<git sha>` and `:main`):

| Image | Role | DB credentials | Port | Health |
|---|---|---|---|---|
| `bsec-migrate` | one-shot, before every deploy | `app_owner` (+ superuser only for first bootstrap) | – | exit code 0 |
| `bsec-web` | storefront, marketing, Store API | `app_rw` | 3000 | `GET /api/health` |
| `bsec-platform` | Platform API (private) | `app_platform` (BYPASSRLS) | 4000 | `GET /health` |
| `bsec-worker` | pg-boss consumers | `app_rw` | 4100 | `GET /health` |
| `bsec-admin` | static SPA (nginx) | none | 8080 | `GET /health` |

---

## 1. Server preparation (both VPSs)
Run as root on a fresh Ubuntu 24.04 install.
```bash
apt update && apt -y full-upgrade && apt -y install ufw fail2ban unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
# 4 GB swap (PLAN §14 budget)
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
# SSH: key-only
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl reload ssh
# Firewall: SSH + HTTP/S only. Postgres is NEVER opened.
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
```
> Docker publishes ports by writing iptables rules that bypass ufw. Therefore **never publish the Postgres port** in Coolify. Services talk over the Coolify Docker network only.

## 2. Install Coolify
```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```
- Open `http://<ip>:8000`, create the admin account, **enable 2FA**, then put the dashboard behind a domain with HTTPS and close 8000 (`ufw deny 8000`).
- Settings → set instance domain; disable "Build server" usage (we only pull).
- Add GHCR credentials: Keys & Tokens → Registry: `ghcr.io`, user = GitHub user, password = a **read:packages** fine-grained PAT.

## 3. Postgres 18
Coolify → New resource → Database → PostgreSQL, image `postgres:18`.
- Name `bsec-postgres`, **"Make it publicly available": off**.
- Superuser password: generate, store in the password manager (not in app env).
- Custom config (production 8 GB): `shared_buffers=1536MB`, `work_mem=8MB`, `max_connections=60`, `effective_cache_size=4GB`, `maintenance_work_mem=256MB`, `wal_level=replica`, `archive_mode=on`, `archive_timeout=60`, `archive_command` per `infra/backups/README.md`.
  Staging: `shared_buffers=768MB`, `max_connections=40`.
- Create database `bsec`.

## 4. Roles bootstrap (once per environment)
Run the migrate image once with the bootstrap command and the **superuser** URL, from Coolify → the migrate resource → "Execute command", or as a one-off:
```bash
docker run --rm --network coolify \
  -e DATABASE_URL_SUPERUSER='postgres://postgres:<superpw>@bsec-postgres:5432/bsec' \
  -e APP_OWNER_PASSWORD='<gen>' -e APP_RW_PASSWORD='<gen>' -e APP_PLATFORM_PASSWORD='<gen>' \
  ghcr.io/brandsewa/bsec-migrate:main node dist/bootstrap.js
```
Idempotent: re-running rotates the three role passwords. The superuser URL is **not** stored in any Coolify app afterwards.

## 5. Applications
Create one Coolify "Docker Image" resource per image, same project + environment, all on the same network as Postgres. Pin to `:main` for staging auto-deploys; production uses the exact `:<sha>` promoted from staging.

### Environment variables
| Resource | Variables |
|---|---|
| migrate | `DATABASE_URL_OWNER=postgres://app_owner:…@bsec-postgres:5432/bsec` |
| web | `DATABASE_URL_RW=postgres://app_rw:…@bsec-postgres:5432/bsec`, `DB_POOL_MAX=10`, `APP_ENV`, `SENTRY_DSN`, `LOG_LEVEL=info` |
| platform | `DATABASE_URL_PLATFORM=postgres://app_platform:…@bsec-postgres:5432/bsec`, `DB_POOL_MAX=3`, `APP_ENV`, `SENTRY_DSN` |
| worker | `DATABASE_URL_RW=…app_rw…`, `WORKER_CONCURRENCY=4`, `APP_ENV`, `SENTRY_DSN` |
| admin | none (static) |

**Checklist (security):** `DATABASE_URL_PLATFORM` exists **only** on the platform resource. The owner URL exists **only** on migrate. Web and worker get `app_rw` only.

### Domains / exposure
- web: `bscommerce.in`, `*.bscommerce.in`, `stores.bscommerce.in` (Cloudflare for SaaS fallback origin) → port 3000.
- admin: `admin.bscommerce.in` → 8080.
- platform: `platform.bscommerce.in` → 4000, **behind Cloudflare Access** (Zero Trust application, platform staff only). Never exposed without Access.
- worker: no domain.

### Resource limits (production, PLAN §14)
web 800 MB, platform 200 MB, worker 400 MB, admin 64 MB. Postgres 2 GB.

### Health checks
Images define `HEALTHCHECK`; also set Coolify health check path per the table above so rolling deploys wait for health.

## 6. Deploy order
1. CI builds and pushes all images on push to `main`.
2. CI calls the staging webhook (`COOLIFY_STAGING_WEBHOOK`) → Coolify:
   **migrate** (must exit 0) → **worker, platform, web, admin** (rolling).
   Configure migrate as the first resource and the others with "depends on / pre-deployment command" so a failed migration stops the rollout.
3. Verify staging (health endpoints, smoke check).
4. Approve the `production` environment in GitHub Actions → production webhook, same order.

GitHub secrets (per environment): `COOLIFY_TOKEN`, `COOLIFY_STAGING_WEBHOOK`, `COOLIFY_PRODUCTION_WEBHOOK` (Coolify → resource → Webhooks → Deploy webhook).

## 7. Rollback
- App: redeploy the previous `:<sha>` tag in Coolify for each resource. Schema stays compatible thanks to expand/contract (`docs/migrations.md`).
- Never roll back a migration by hand in production. Write a forward fix.
- Data: point-in-time restore per `infra/backups/README.md`.

## 8. Observability
- Sentry: one project per service (`web`, `platform`, `worker`), `SENTRY_DSN` per resource. Code no-ops when unset.
- Logs: pino JSON on stdout with `request_id` and `tenant_id`. Ship with Better Stack (Coolify → Logs drain, or Vector container) per service.
- Uptime (Better Stack): `https://bscommerce.in/api/health`, `https://admin.bscommerce.in/health`, platform health through Access service token.

## 9. Gotchas
- Only publish Postgres on the internal network; ufw does not protect Docker-published ports.
- `app_platform` has BYPASSRLS: treat its password like the superuser's.
- Staging and production never share a database, bucket or secrets.
- Keep the VPS free of build tools; if a build is needed, it belongs in GitHub Actions.
