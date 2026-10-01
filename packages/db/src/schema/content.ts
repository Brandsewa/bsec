import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";

/**
 * Themes (PLAN §5.9).
 * Tokens only, no code.
 */
export const themes = tenantTable(
  "themes",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    templateCode: text("template_code").notNull().default("default"),
    // Version of the platform template this store last copied from (M10). Lets the admin show
    // "a newer version exists" without ever overwriting the store's own customizations.
    templateVersion: integer("template_version").notNull().default(1),
    name: text("name").notNull().default("Default Theme"),
    tokens: jsonb("tokens").notNull(),
    status: text("status").notNull().default("draft"), // draft, published
    publishedAt: timestamp("published_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("themes_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

/**
 * Pages (PLAN §5.9).
 */
export const pages = tenantTable(
  "pages",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    type: text("type").notNull().default("custom"), // home, landing, custom, product_template, collection_template
    title: text("title").notNull(),
    slug: citext("slug").notNull(),
    seo: jsonb("seo"),
    status: text("status").notNull().default("draft"), // draft, published
    publishedVersionId: uuid("published_version_id"),
    draftVersionId: uuid("draft_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("pages_tenant_slug_uniq").on(t.tenantId, t.slug),
    unique("pages_tenant_id_uniq").on(t.tenantId, t.id),
    index("pages_tenant_type_idx").on(t.tenantId, t.type),
  ],
);

/**
 * Page Versions (PLAN §5.9, ADR-009).
 * document contains: { blocks: [{ id, type, version, props }] }
 */
export const pageVersions = tenantTable(
  "page_versions",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    pageId: uuid("page_id").notNull(),
    document: jsonb("document").notNull(),
    createdBy: uuid("created_by"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.pageId,
      target: pages,
      name: "page_versions_page_fk",
      onDelete: "cascade",
    }),
    index("page_versions_tenant_page_idx").on(t.tenantId, t.pageId),
  ],
);

/**
 * Navigation Menus (PLAN §5.9).
 */
export const menus = tenantTable(
  "menus",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    handle: text("handle").notNull(), // header, footer, custom
    title: text("title").notNull(),
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("menus_tenant_handle_uniq").on(t.tenantId, t.handle),
  ],
);
