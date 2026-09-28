import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/schema/index.ts";
import { tenantTableNames } from "../src/tenant-table.ts";

describe("M1 Schema Definitions", () => {
  it("exports all expected platform tables", () => {
    expect(schema.tenants).toBeDefined();
    expect(schema.organizations).toBeDefined();
    expect(schema.domains).toBeDefined();
    expect(schema.featureFlags).toBeDefined();
    expect(schema.tenantFeatureOverrides).toBeDefined();
    expect(schema.platformStaff).toBeDefined();
  });

  it("exports all expected identity tables", () => {
    expect(schema.users).toBeDefined();
    expect(schema.sessions).toBeDefined();
    expect(schema.accounts).toBeDefined();
    expect(schema.verifications).toBeDefined();
    expect(schema.roles).toBeDefined();
    expect(schema.memberships).toBeDefined();
    expect(schema.staffInvitations).toBeDefined();
    expect(schema.auditLogs).toBeDefined();
    expect(schema.customerSessions).toBeDefined();
  });

  it("exports all expected settings tables", () => {
    expect(schema.storeSettings).toBeDefined();
  });

  it("registers all tenant tables in tenantTableNames", () => {
    const expected = [
      "tenant_feature_overrides",
      "roles",
      "memberships",
      "staff_invitations",
      "audit_logs",
      "customer_sessions",
      "store_settings",
    ];
    for (const name of expected) {
      expect(tenantTableNames.has(name), `Missing registration for ${name}`).toBe(true);
    }
  });

  it("enforces tenant-scoped unique constraints and composite FKs on memberships", () => {
    const cfg = getTableConfig(schema.memberships);
    expect(cfg.enableRLS).toBe(true);
    const uniq = cfg.uniqueConstraints.find((u) => u.name === "memberships_tenant_user_uniq");
    expect(uniq).toBeDefined();

    const roleFk = cfg.foreignKeys.find((f) => f.getName() === "memberships_role_fk");
    expect(roleFk).toBeDefined();
    expect(roleFk?.onDelete).toBe("restrict");
    const ref = roleFk?.reference();
    expect(ref?.columns.map((c) => c.name)).toEqual(["tenant_id", "role_id"]);
    expect(ref?.foreignColumns.map((c) => c.name)).toEqual(["tenant_id", "id"]);
  });

  it("enforces tenant-scoped unique constraint on store_settings", () => {
    const cfg = getTableConfig(schema.storeSettings);
    expect(cfg.enableRLS).toBe(true);
    const uniq = cfg.uniqueConstraints.find((u) => u.name === "store_settings_tenant_id_uniq");
    expect(uniq).toBeDefined();
    expect(uniq?.columns.map((c) => c.name)).toEqual(["tenant_id"]);
  });

  it("enforces tenant-scoped unique constraint on roles", () => {
    const cfg = getTableConfig(schema.roles);
    expect(cfg.enableRLS).toBe(true);
    const uniq = cfg.uniqueConstraints.find((u) => u.name === "roles_tenant_name_uniq");
    expect(uniq).toBeDefined();
    expect(uniq?.columns.map((c) => c.name)).toEqual(["tenant_id", "name"]);
  });

  it("exports all expected M2 catalog, inventory, and media tables", () => {
    expect(schema.products).toBeDefined();
    expect(schema.productOptions).toBeDefined();
    expect(schema.variants).toBeDefined();
    expect(schema.productMedia).toBeDefined();
    expect(schema.categories).toBeDefined();
    expect(schema.productCategories).toBeDefined();
    expect(schema.collections).toBeDefined();
    expect(schema.collectionProducts).toBeDefined();
    expect(schema.brands).toBeDefined();
    expect(schema.locations).toBeDefined();
    expect(schema.inventoryLevels).toBeDefined();
    expect(schema.inventoryMovements).toBeDefined();
    expect(schema.media).toBeDefined();
  });

  it("registers M2 catalog tables in tenantTableNames", () => {
    const expected = [
      "products",
      "product_options",
      "variants",
      "product_media",
      "categories",
      "product_categories",
      "collections",
      "collection_products",
      "brands",
      "locations",
      "inventory_levels",
      "inventory_movements",
      "media",
    ];
    for (const name of expected) {
      expect(tenantTableNames.has(name), `Missing registration for ${name}`).toBe(true);
    }
  });

  it("enforces composite foreign keys on catalog relationships", () => {
    const variantCfg = getTableConfig(schema.variants);
    const prodFk = variantCfg.foreignKeys.find((f) => f.getName() === "variants_product_fk");
    expect(prodFk).toBeDefined();
    expect(prodFk?.reference().columns.map((c) => c.name)).toEqual(["tenant_id", "product_id"]);
    expect(prodFk?.reference().foreignColumns.map((c) => c.name)).toEqual(["tenant_id", "id"]);

    const invCfg = getTableConfig(schema.inventoryLevels);
    const variantFk = invCfg.foreignKeys.find((f) => f.getName() === "inventory_levels_variant_fk");
    expect(variantFk).toBeDefined();
    expect(variantFk?.reference().columns.map((c) => c.name)).toEqual(["tenant_id", "variant_id"]);
  });

  it("exports branding, theme, pages, and menus tables", () => {
    expect(schema.brandSettings).toBeDefined();
    expect(schema.themes).toBeDefined();
    expect(schema.pages).toBeDefined();
    expect(schema.pageVersions).toBeDefined();
    expect(schema.menus).toBeDefined();
  });

  it("registers branding and content tables in tenantTableNames", () => {
    const expected = [
      "brand_settings",
      "themes",
      "pages",
      "page_versions",
      "menus",
    ];
    for (const name of expected) {
      expect(tenantTableNames.has(name), `Missing registration for ${name}`).toBe(true);
    }
  });

  it("enforces tenant-scoped unique constraints on brand_settings, pages, and menus", () => {
    const brandCfg = getTableConfig(schema.brandSettings);
    expect(brandCfg.enableRLS).toBe(true);
    const brandUniq = brandCfg.uniqueConstraints.find((u) => u.name === "brand_settings_tenant_id_uniq");
    expect(brandUniq).toBeDefined();

    const pageCfg = getTableConfig(schema.pages);
    expect(pageCfg.enableRLS).toBe(true);
    const pageUniq = pageCfg.uniqueConstraints.find((u) => u.name === "pages_tenant_slug_uniq");
    expect(pageUniq).toBeDefined();

    const menuCfg = getTableConfig(schema.menus);
    expect(menuCfg.enableRLS).toBe(true);
    const menuUniq = menuCfg.uniqueConstraints.find((u) => u.name === "menus_tenant_handle_uniq");
    expect(menuUniq).toBeDefined();
  });

  it("exports M3 storefront tables", () => {
    expect(schema.storeStatus).toBeDefined();
    expect(schema.seoSettings).toBeDefined();
    expect(schema.searchQueries).toBeDefined();
    expect(schema.newsletterSubscribers).toBeDefined();
    expect(schema.carts).toBeDefined();
    expect(schema.cartItems).toBeDefined();
  });

  it("registers M3 storefront tables in tenantTableNames", () => {
    const expected = [
      "store_status",
      "seo_settings",
      "search_queries",
      "newsletter_subscribers",
      "carts",
      "cart_items",
    ];
    for (const name of expected) {
      expect(tenantTableNames.has(name), `Missing registration for ${name}`).toBe(true);
    }
  });

  it("enforces tenant-scoped unique constraints and FKs on M3 storefront tables", () => {
    const statusCfg = getTableConfig(schema.storeStatus);
    expect(statusCfg.enableRLS).toBe(true);
    expect(statusCfg.uniqueConstraints.some((u) => u.columns.map((c) => c.name).join(",") === "tenant_id")).toBe(true);

    const seoCfg = getTableConfig(schema.seoSettings);
    expect(seoCfg.enableRLS).toBe(true);
    expect(seoCfg.uniqueConstraints.some((u) => u.columns.map((c) => c.name).join(",") === "tenant_id")).toBe(true);

    const searchCfg = getTableConfig(schema.searchQueries);
    expect(searchCfg.enableRLS).toBe(true);
    expect(searchCfg.uniqueConstraints.some((u) => u.columns.map((c) => c.name).join(",") === "tenant_id,normalized_query,day")).toBe(true);

    const newsCfg = getTableConfig(schema.newsletterSubscribers);
    expect(newsCfg.enableRLS).toBe(true);
    expect(newsCfg.uniqueConstraints.some((u) => u.columns.map((c) => c.name).join(",") === "tenant_id,email")).toBe(true);

    const cartCfg = getTableConfig(schema.carts);
    expect(cartCfg.enableRLS).toBe(true);
    expect(cartCfg.uniqueConstraints.some((u) => u.columns.map((c) => c.name).join(",") === "tenant_id,token")).toBe(true);

    const cartItemsCfg = getTableConfig(schema.cartItems);
    expect(cartItemsCfg.enableRLS).toBe(true);
    expect(cartItemsCfg.uniqueConstraints.some((u) => u.columns.map((c) => c.name).join(",") === "tenant_id,cart_id,variant_id")).toBe(true);
    const cartFk = cartItemsCfg.foreignKeys.find((f) => f.reference().columns.map((c) => c.name).join(",") === "tenant_id,cart_id");
    expect(cartFk?.onDelete).toBe("cascade");
    const variantFk = cartItemsCfg.foreignKeys.find((f) => f.reference().columns.map((c) => c.name).join(",") === "tenant_id,variant_id");
    expect(variantFk?.onDelete).toBe("restrict");
  });
});


