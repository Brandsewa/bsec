# Fast local integration tests & dev-speed workflow

By default, each `*.int.test.ts` file starts its own Testcontainers Postgres and runs every migration (slow, one container per file, 10–12 minutes locally).

With one long-lived, in-memory Postgres (`docker-compose.test-db.yml`), the whole domain integration suite runs in **~235 seconds** without flaking, and teardown is completely clean.

---

## 1. Quick Workflow Commands

The local development loop:

```bash
# Run tests affected by your uncommitted / branch changes against origin/main:
pnpm test:affected

# Run affected tests including heavy integration tests:
pnpm test:affected --heavy

# Run the complete domain heavy test suite with the local shared Postgres test DB:
pnpm test:heavy:local

# Full pre-push quick gate (typecheck -> lint -> docs:check -> test:affected):
pnpm gate:quick
```

---

## 2. Fast Local Test Database (`docker-compose.test-db.yml`)

The `pnpm test:heavy:local` script automatically manages `docker-compose.test-db.yml` and configures `TEST_PG_ADMIN_URL`:

```bash
# Manual control (optional):
docker compose -f docker-compose.test-db.yml up -d
$env:TEST_PG_ADMIN_URL = "postgres://postgres:postgres@localhost:55432/postgres"   # PowerShell
export TEST_PG_ADMIN_URL=postgres://postgres:postgres@localhost:55432/postgres      # bash
pnpm --filter @bs/domain test:heavy
```

To stop and remove the test container:
```bash
pnpm test:heavy:local --down
# or
docker compose -f docker-compose.test-db.yml down
```

### How it works (`packages/db/test-support/shared-pg.ts`):
- Once per run, a template database with roles and all migrations applied is built. Its name contains a hash of the migration files, so adding or editing a migration rebuilds it automatically.
- Each test file gets its own database cloned from the template (`createdb -T ...`) and dropped afterwards, so files cannot interfere with each other.
- Tests are unchanged. The setup file sets `TEST_DATABASE_URL_SUPERUSER` for each file, which the tests already honour.
- Connection pools attached to `app_platform` and `app_rw` now register an idle error handler (`pool.on("error", ...)`), and test teardown forcibly terminates lingering backend connections before drop, eliminating 57P01 unhandled connection termination errors.

---

## 3. Investigation on Windows Worker Crash `3221226505` (0xC0000409)

When running massive test suites under Vitest on Windows:
- **Root cause:** Exit code `3221226505` (hex `0xC0000409` - `STATUS_STACK_BUFFER_OVERRUN`) occurs on Windows when worker processes terminate with active background timers or native asynchronous C++ addon handles (such as Argon2/Bcrypt or sharp native memory contexts).
- **Resolution & Rerun Rule:** Running Vitest with clean connection teardown and avoiding unhandled pool terminations stabilizes worker teardown. If a single worker crash is encountered in a long run on Windows:
  1. Simply rerun the failed test file directly (`pnpm --filter @bs/domain test:fast <file>`).
  2. Or run via `pnpm test:affected` / `pnpm test:heavy:local`.

---

## 4. Test Factories (`packages/domain/test/helpers/factories.ts`)

Integration tests should use shared factories to reduce boilerplate and speed up setup:
- `primaryCategory(rt, ctx)`: Returns a cached category id per store.
- `createActiveProduct(rt, ctx, opts)`: Creates an active product with category, variant, and stocked inventory.
- `createGuestCheckout(rt, ctx, opts)`: Creates a cart, adds variant, and places a guest COD order.
- `createDeliveredCodOrder(rt, ctx, opts)`: Places a guest COD order and marks order and fulfillment as delivered.

---

## 5. Admin Procedure Scaffolding

To scaffold a standard admin procedure, domain service, integration test, and snippet implementations:

```bash
# Dry-run (prints snippets and code skeletons):
pnpm scaffold:admin-procedure <area> <name>

# Write files directly to disk:
pnpm scaffold:admin-procedure orders archive-order --write
```
