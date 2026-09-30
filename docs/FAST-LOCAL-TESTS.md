# Fast local integration tests (optional)

By default each `*.int.test.ts` file starts its own Testcontainers Postgres and runs every migration (slow, one container per file).
With one long-lived, in-memory Postgres the whole domain suite runs in about 70 seconds instead of many minutes, and files run in parallel.

```bash
docker compose -f docker-compose.test-db.yml up -d
export TEST_PG_ADMIN_URL=postgres://postgres:postgres@localhost:55432/postgres   # PowerShell: $env:TEST_PG_ADMIN_URL = "..."
pnpm --filter @bs/domain test        # or @bs/db
```

How it works (`packages/db/test-support/shared-pg.ts`):
- Once per run, a template database with roles and all migrations applied is built. Its name contains a hash of the migration files, so adding or editing a migration rebuilds it automatically.
- Each test file gets its own database cloned from the template and dropped afterwards, so files cannot interfere with each other.
- Tests are unchanged. The setup file sets `TEST_DATABASE_URL_SUPERUSER` for each file, which the tests already honour.

Notes:
- Unset `TEST_PG_ADMIN_URL` to go back to Testcontainers. CI is untouched (it uses `TEST_DATABASE_URL_SUPERUSER` and runs files serially).
- The container keeps data in memory with `fsync=off`. It is disposable and only for tests. `docker compose -f docker-compose.test-db.yml down` wipes it.
- If a run is killed, leftover `bsec_t_*` databases can be ignored; they vanish when the container is removed.
