import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { citext } from "./custom-types.ts";
import { media } from "./catalog.ts";

/**
 * Blog (ADR-033). Tenant tables with forced RLS; references between them are composite.
 * Category depth (category -> subcategory) is enforced in the domain service.
 */
export const blogCategories = tenantTable(
  "blog_categories",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    slug: citext("slug").notNull(),
    description: text("description"),
    imageMediaId: uuid("image_media_id"),
    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    seo: jsonb("seo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("blog_categories_tenant_slug_uniq").on(t.tenantId, t.slug),
    unique("blog_categories_tenant_id_uniq").on(t.tenantId, t.id),
    index("blog_categories_tenant_parent_idx").on(t.tenantId, t.parentId, t.position),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.parentId,
      target: { tenantId: t.tenantId, id: t.id },
      name: "blog_categories_parent_fk",
      onDelete: "restrict",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.imageMediaId,
      target: media,
      name: "blog_categories_image_media_fk",
      onDelete: "set null",
    }),
  ],
);

export const blogPosts = tenantTable(
  "blog_posts",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    title: text("title").notNull(),
    slug: citext("slug").notNull(),
    // Plain text, max 300 (domain service).
    excerpt: text("excerpt"),
    // Sanitised on every write; never trusted from the browser.
    contentHtml: text("content_html").notNull().default(""),
    contentText: text("content_text").notNull().default(""),
    readingMinutes: integer("reading_minutes").notNull().default(1),
    featuredImageMediaId: uuid("featured_image_media_id"),
    featuredImageAlt: text("featured_image_alt"),
    categoryId: uuid("category_id"),
    authorUserId: uuid("author_user_id"),
    authorName: text("author_name").notNull().default(""),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    isFeatured: boolean("is_featured").notNull().default(false),
    seo: jsonb("seo"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("blog_posts_tenant_slug_uniq").on(t.tenantId, t.slug),
    unique("blog_posts_tenant_id_uniq").on(t.tenantId, t.id),
    index("blog_posts_tenant_status_published_idx").on(t.tenantId, t.status, t.publishedAt),
    index("blog_posts_tenant_category_published_idx").on(t.tenantId, t.categoryId, t.publishedAt),
    check("blog_posts_status_chk", sql`${t.status} in ('draft', 'scheduled', 'published')`),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.categoryId,
      target: blogCategories,
      name: "blog_posts_category_fk",
      onDelete: "set null",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.featuredImageMediaId,
      target: media,
      name: "blog_posts_featured_media_fk",
      onDelete: "set null",
    }),
  ],
);

/** Old slug of a published post -> the post, so `/blog/<old>` can answer 308. */
export const blogSlugRedirects = tenantTable(
  "blog_slug_redirects",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    fromSlug: citext("from_slug").notNull(),
    postId: uuid("post_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("blog_slug_redirects_tenant_from_uniq").on(t.tenantId, t.fromSlug),
    unique("blog_slug_redirects_tenant_id_uniq").on(t.tenantId, t.id),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.postId,
      target: blogPosts,
      name: "blog_slug_redirects_post_fk",
      onDelete: "cascade",
    }),
  ],
);
