import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { bootstrapRoles } from "../src/scripts/bootstrap-roles.ts";
import { runMigrations } from "../src/scripts/migrate.ts";

/** Role passwords every integration test uses (the roles are cluster-wide, so they must be the same everywhere). */
export const TEST_PASSWORDS = { owner: "o_test", rw: "rw_test", platform: "p_test", saas: "s_test" } as const;

export type TestRole = "app_owner" | "app_rw" | "app_platform" | "app_saas";

export interface TestDb {
  /** Superuser connection string of this test's database. */
  superUrl: string;
  /** Connection string for one of the application roles. */
  as(role: TestRole): string;
  stop(): Promise<void>;
}

/**
 * Starts (or connects to) a real Postgres 18 with the application roles bootstrapped and every migration applied.
 * Uses TEST_DATABASE_URL_SUPERUSER when set (CI, or the fast shared server mode), a Testcontainers Postgres otherwise.
 */
export async function startTestDb(): Promise<TestDb> {
  let container: StartedPostgreSqlContainer | undefined;
  let superUrl: string;
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  const pw: Record<TestRole, string> = {
    app_owner: TEST_PASSWORDS.owner,
    app_rw: TEST_PASSWORDS.rw,
    app_platform: TEST_PASSWORDS.platform,
    app_saas: TEST_PASSWORDS.saas,
  };
  const as = (role: TestRole): string => {
    const u = new URL(superUrl);
    u.username = role;
    u.password = pw[role];
    return u.toString();
  };
  await bootstrapRoles(superUrl, TEST_PASSWORDS);
  await runMigrations(as("app_owner"));
  return { superUrl, as, stop: async () => void (await container?.stop()) };
}
