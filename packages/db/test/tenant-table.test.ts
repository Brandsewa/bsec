import { describe, expect, it } from "vitest";
import { getTableConfig, text } from "drizzle-orm/pg-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { forceRlsSql, tenantTable } from "../src/tenant-table.ts";

describe("tenantTable() stub", () => {
  const widgets = tenantTable("widgets", { name: text("name").notNull() });
  const cfg = getTableConfig(widgets);

  it("adds a non-null tenant_id column", () => {
    const col = cfg.columns.find((c) => c.name === "tenant_id");
    expect(col?.notNull).toBe(true);
    expect(col?.getSQLType()).toBe("uuid");
  });

  it("enables RLS with a nullif() tenant policy for USING and WITH CHECK", () => {
    expect(cfg.enableRLS).toBe(true);
    expect(cfg.policies).toHaveLength(1);
    const p = cfg.policies[0]!;
    const dialect = new PgDialect();
    for (const clause of [p.using, p.withCheck]) {
      expect(dialect.sqlToQuery(clause!).sql).toBe(
        "tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid",
      );
    }
  });

  it("emits FORCE RLS sql", () => {
    expect(forceRlsSql("widgets")).toContain('ALTER TABLE "widgets" FORCE ROW LEVEL SECURITY;');
  });
});
