# bsec system diagram

A one-page picture of the whole platform: who uses it, what runs where, which languages and tools, backups, monitoring and the deploy pipeline. It is the visual companion to [`ARCHITECTURE.md`](ARCHITECTURE.md), which stays the source of truth. If the two disagree, the code wins, then `ARCHITECTURE.md`, then this file.

| Copy | What it is | Use it for |
|---|---|---|
| **This file** (Mermaid below) | Text diagram, renders on GitHub and in most editors, diffs cleanly | Quick local reference, review in pull requests |
| [`diagrams/system-board.json`](diagrams/system-board.json) | Snapshot of the whiteboard (every box, arrow and label) | Offline record, restoring the board if it is lost |
| Whiteboard artifact (live) | The styled, editable board, created 2026-11-25 in the Claude app | Presenting, walking someone through the system |

Whiteboard: <https://claude.ai/artifact/PTbu9tSNxj4wdN2UizABbJ> (private to its owner until shared).

Colour key: edge and outside watchers, services, data and backups, build and ship. Dashed boxes are planned or not live yet.

```mermaid
flowchart TB
  subgraph users["Users and edge"]
    M["Merchants<br/>admin.bcom.si"]
    S["Shoppers<br/>store.bcom.si or own domain"]
    P["Platform staff<br/>superadmin.bcom.si"]
    CF["Cloudflare<br/>DNS, TLS, Turnstile<br/>wildcard + custom domains"]
    M -->|HTTPS| CF
    S -->|HTTPS| CF
    P -->|HTTPS| CF
  end

  CF -->|routes by hostname| VPS

  subgraph VPS["Single VPS (Hostinger) - Coolify + Traefik + Docker - ports 22, 80, 443 only"]
    ADM["bsec-admin<br/>Vite, React 19 SPA<br/>nginx :8080, no DB"]
    WEB["bsec-web<br/>Next.js 16, React 19<br/>Storefront + Store API :3000<br/>role app_rw"]
    WRK["bsec-worker<br/>Node, pg-boss<br/>email, expiry, sweeps :4100<br/>role app_rw"]
    PLT["bsec-platform<br/>Hono, oRPC, Better Auth + MFA<br/>Staff API :4000<br/>role app_platform"]
    SAD["bsec-superadmin<br/>Vite, React 19 SPA<br/>nginx :8081, no DB"]
    ADM -->|oRPC /api| WEB
    SAD -->|oRPC| PLT
  end

  subgraph data["Data"]
    DB[("PostgreSQL 18<br/>one DB for all stores<br/>RLS on every tenant table<br/>pg-boss queue<br/>roles app_owner, app_rw, app_saas, app_platform")]
    R2["Cloudflare R2<br/>product images<br/>media.bcom.si"]
    MIG["bsec-migrate<br/>one-shot, role app_owner<br/>runs before each deploy"]
  end

  WEB -->|"SQL, RLS enforced"| DB
  WRK -->|"SQL, job queue"| DB
  PLT -->|"SQL, bypasses RLS"| DB
  WEB -.->|image uploads| R2
  MIG -->|applies migrations| DB

  subgraph ops["Backups and monitoring"]
    PGB["pgBackRest on bsec-postgres<br/>WAL archived continuously<br/>full Sat, diff Sun-Fri, 03:30 IST<br/>30-day retention"]
    BKT["R2 bucket bsec-pgbackrest<br/>off-server copy"]
    COPY["Second copy<br/>weekly, second Cloudflare account<br/>PLANNED"]
    SNAP["Hostinger snapshots<br/>weekly, whole VPS<br/>last resort"]
    BS["Better Stack<br/>uptime monitors on web, admin, platform<br/>every 3 min + public status page"]
    SEN["Sentry error tracking<br/>PLANNED"]
    ACC["Cloudflare Access on Super Admin<br/>PLANNED"]
  end

  DB -->|WAL + backups| PGB
  PGB -->|archive over TLS| BKT
  BKT -.->|weekly copy| COPY

  subgraph ship["Build and ship (push to main that passes CI deploys to production)"]
    GH["GitHub<br/>public repo, pnpm + Turborepo"]
    GA["GitHub Actions<br/>typecheck, lint, tests, Gitleaks, e2e"]
    GHCR["ghcr.io<br/>one image per app<br/>:sha then :main"]
    COOL["Coolify<br/>runs migrate, restarts the five apps"]
    GH -->|on push| GA -->|build images| GHCR -->|pull :main| COOL
  end

  COOL -.->|deploys| VPS

  classDef edge fill:#fff3b0,stroke:#c9a400,color:#000
  classDef svc fill:#cfe3ff,stroke:#3b6fd4,color:#000
  classDef store fill:#cdeccd,stroke:#2e8b3e,color:#000
  classDef ci fill:#e3d4f7,stroke:#7b4bb7,color:#000
  classDef planned fill:#fff,stroke:#999,stroke-dasharray: 5 4,color:#000
  class CF,BS edge
  class ADM,WEB,WRK,PLT,SAD,MIG svc
  class DB,R2,PGB,BKT,SNAP store
  class GH,GA,GHCR,COOL ci
  class COPY,SEN,ACC planned
```

## Languages and tools

| Layer | What we use |
|---|---|
| Language | TypeScript 6 (strict) end to end, SQL migrations |
| Frontend | React 19, Next.js 16 (Cache Components), Vite, TanStack Router, Tailwind, shadcn on Base UI, Puck page editor |
| Backend | Hono, oRPC with Zod contracts, Better Auth, Drizzle ORM, pg-boss queues; all business logic in `packages/domain` |
| Data | PostgreSQL 18 with row-level security, Cloudflare R2 for media |
| Tooling | Node 24, pnpm 10, Turborepo, Vitest, Playwright, ESLint 10, Docker, k6 load tests |
| Payments | COD live; Razorpay per store; Stripe and PayPal for other markets. Shiprocket and email delivery not live yet |

## Keeping it current

Update this diagram **in the same change** whenever you:

- add, remove or rename a deployed service or change a port or DB role,
- add a data store, bucket, queue provider or external service (monitoring, error tracking, email, payments, CDN),
- change the backup schedule, retention, destination or recovery path,
- change the CI/CD pipeline stages or the deploy target,
- move something from planned to live (drop the dashed style and the "planned" word).

How, in order:

1. Edit the Mermaid block above (this is the reviewed copy).
2. Update the whiteboard to match (Claude can do this: ask it to "update the system board from `docs/SYSTEM-DIAGRAM.md`").
3. Refresh the snapshot: ask Claude to re-export the board to `docs/diagrams/system-board.json`, and bump the date in its `exported` field.
4. Update the matching section of `ARCHITECTURE.md` (section 2 and 4 for topology, 3 for apps and packages) and mention the diagram in your change record.

Never put secrets, server IPs or credentials on the diagram or in the snapshot (AGENTS.md section 5: the repository is public).

Last updated: 2026-11-25 (initial version, matches `ARCHITECTURE.md` as verified at `main` ce06cbf plus the backup and monitoring state of 2026-11-25).
