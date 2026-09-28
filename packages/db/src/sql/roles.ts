/**
 * Role model (PLAN §4, ADR-002).
 *  - app_owner    owns every table; runs migrations only. Subject to FORCE RLS like everyone else.
 *  - app_rw       web + worker. NOBYPASSRLS, DML only, never owns anything.
 *  - app_platform platform container only. BYPASSRLS, DML only.
 * Idempotent: safe to run on every deploy. Needs a superuser connection (BYPASSRLS can only be granted by one).
 */
export interface RolePasswords {
  owner: string;
  rw: string;
  platform: string;
}

const lit = (s: string) => `'${s.replaceAll("'", "''")}'`;

function upsertRole(name: string, password: string, attrs: string): string {
  return `
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${name}') THEN
    CREATE ROLE ${name} LOGIN ${attrs} PASSWORD ${lit(password)};
  ELSE
    ALTER ROLE ${name} LOGIN ${attrs} PASSWORD ${lit(password)};
  END IF;
END $$;`;
}

export function rolesSql(database: string, pw: RolePasswords): string {
  const db = `"${database.replaceAll('"', '""')}"`;
  return [
    upsertRole("app_owner", pw.owner, "NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS"),
    upsertRole("app_rw", pw.rw, "NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS NOINHERIT"),
    upsertRole("app_platform", pw.platform, "NOSUPERUSER NOCREATEROLE NOCREATEDB BYPASSRLS NOINHERIT"),
    `REVOKE ALL ON DATABASE ${db} FROM PUBLIC;`,
    // CREATE lets app_owner create the drizzle + pgboss schemas and trusted extensions (citext, pg_trgm).
    `GRANT CONNECT, CREATE, TEMPORARY ON DATABASE ${db} TO app_owner;`,
    `GRANT CONNECT ON DATABASE ${db} TO app_rw, app_platform;`,
    `ALTER SCHEMA public OWNER TO app_owner;`,
    `REVOKE CREATE ON SCHEMA public FROM PUBLIC;`,
    `GRANT USAGE ON SCHEMA public TO app_rw, app_platform;`,
    // Everything app_owner creates later, in any schema, is DML-accessible to the runtime roles.
    `ALTER DEFAULT PRIVILEGES FOR ROLE app_owner GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw, app_platform;`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE app_owner GRANT USAGE, SELECT ON SEQUENCES TO app_rw, app_platform;`,
  ].join("\n");
}
