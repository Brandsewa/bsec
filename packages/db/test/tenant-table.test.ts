import { describe, expect, it } from "vitest";
import { getTableConfig, text, uuid, unique } from "drizzle-orm/pg-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { forceRlsSql, tenantForeignKey, tenantTable } from "../src/tenant-table.ts";

describe("tenantTable() helper", () => {
  const widgets = tenantTable("widgets", {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
  }, (t) => [
    unique("widgets_tenant_name_uniq").on(t.tenantId, t.name),
  ]);
  const cfg = getTableConfig(widgets);

  it("adds a non-null tenant_id column", () => {
    const col = cfg.columns.find((c) => c.name === "tenant_id");
    expect(col?.notNull).toBe(true);
    expect(col?.getSQLType()).toBe("uuid");
  });

  it("references tenants.id with onDelete restrict", () => {
    const fk = cfg.foreignKeys.find((f) => f.reference().columns.some((c) => c.name === "tenant_id"));
    expect(fk).toBeDefined();
    expect(fk?.onDelete).toBe("restrict");
    const targetTable = (fk?.reference().foreignTable as unknown as Record<string | symbol, string>)[Symbol.for("drizzle:Name")];
    expect(targetTable).toBe("tenants");
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

  it("supports extraConfig including unique constraints", () => {
    expect(cfg.uniqueConstraints).toHaveLength(1);
    expect(cfg.uniqueConstraints[0]?.name).toBe("widgets_tenant_name_uniq");
  });

  it("supports composite foreign keys via tenantForeignKey", () => {
    const parts = tenantTable("parts", {
      id: uuid("id").primaryKey(),
      widgetId: uuid("widget_id").notNull(),
    }, (t) => [
      tenantForeignKey({
        tableTenantId: t.tenantId,
        column: t.widgetId,
        target: widgets,
        onDelete: "restrict",
        name: "parts_widget_composite_fk",
      }),
    ]);
    const partsCfg = getTableConfig(parts);
    const compositeFk = partsCfg.foreignKeys.find((f) => f.getName() === "parts_widget_composite_fk");
    expect(compositeFk).toBeDefined();
    expect(compositeFk?.onDelete).toBe("restrict");
    const ref = compositeFk?.reference();
    expect(ref?.columns.map((c) => c.name)).toEqual(["tenant_id", "widget_id"]);
    expect(ref?.foreignColumns.map((c) => c.name)).toEqual(["tenant_id", "id"]);
  });

  it("emits FORCE RLS sql", () => {
    expect(forceRlsSql("widgets")).toContain('ALTER TABLE "widgets" FORCE ROW LEVEL SECURITY;');
  });
});
