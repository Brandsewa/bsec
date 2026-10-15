import { oc } from "@orpc/contract";
import { z } from "zod";

/** Admin contract for the blog (ADR-033). Dates travel as ISO strings, like the other admin contracts. */

export const BlogSeo = z.object({
  title: z.string().max(120).nullable().optional(),
  description: z.string().max(320).nullable().optional(),
  imageMediaId: z.string().uuid().nullable().optional(),
  noindex: z.boolean().optional(),
});
export type BlogSeo = z.infer<typeof BlogSeo>;

export const BlogPostStatus = z.enum(["draft", "scheduled", "published"]);

const CategoryBase = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  imageMediaId: z.string().uuid().nullable(),
  position: z.number().int(),
  isActive: z.boolean(),
  seo: BlogSeo.nullable(),
  postCount: z.number().int(),
});
export const BlogCategoryItem = CategoryBase.extend({ children: z.array(CategoryBase).optional() });
export type BlogCategoryItem = z.infer<typeof BlogCategoryItem>;

export const BlogPostListItem = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  status: BlogPostStatus,
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  authorName: z.string(),
  categoryId: z.string().uuid().nullable(),
  categoryName: z.string().nullable(),
  featuredImageMediaId: z.string().uuid().nullable(),
  /** Public address of the featured image, for list thumbnails. */
  featuredImageUrl: z.string().nullable(),
  isFeatured: z.boolean(),
});
export type BlogPostListItem = z.infer<typeof BlogPostListItem>;

export const BlogPostDetail = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  contentHtml: z.string(),
  readingMinutes: z.number().int(),
  featuredImageMediaId: z.string().uuid().nullable(),
  featuredImageAlt: z.string().nullable(),
  categoryId: z.string().uuid().nullable(),
  authorName: z.string(),
  status: BlogPostStatus,
  publishedAt: z.string().nullable(),
  isFeatured: z.boolean(),
  seo: BlogSeo.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BlogPostDetail = z.infer<typeof BlogPostDetail>;

export const BlogSettings = z.object({
  enabled: z.boolean(),
  title: z.string().max(120),
  description: z.string().max(320),
  postsPerPage: z.number().int().min(3).max(48),
});
export type BlogSettings = z.infer<typeof BlogSettings>;

const PostFields = {
  title: z.string().min(1).max(200),
  slug: z.string().max(120).optional(),
  excerpt: z.string().max(300).nullable().optional(),
  contentHtml: z.string().max(200_000).optional(),
  featuredImageMediaId: z.string().uuid().nullable().optional(),
  featuredImageAlt: z.string().max(300).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  authorName: z.string().max(120).optional(),
  status: BlogPostStatus.optional(),
  publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
  isFeatured: z.boolean().optional(),
  seo: BlogSeo.nullable().optional(),
};

const Id = z.object({ id: z.string().uuid() });
const Ok = z.object({ ok: z.literal(true) });

export const blogContract = {
  categories: {
    list: oc.route({ method: "GET", path: "/admin/blog/categories" }).output(z.array(BlogCategoryItem)),
    create: oc
      .route({ method: "POST", path: "/admin/blog/categories" })
      .input(
        z.object({
          name: z.string().min(1).max(120),
          slug: z.string().max(120).optional(),
          parentId: z.string().uuid().nullable().optional(),
          description: z.string().max(300).nullable().optional(),
          imageMediaId: z.string().uuid().nullable().optional(),
          isActive: z.boolean().optional(),
          seo: BlogSeo.nullable().optional(),
        }),
      )
      .output(z.object({ id: z.string().uuid(), slug: z.string() })),
    update: oc
      .route({ method: "PATCH", path: "/admin/blog/categories/{id}" })
      .input(
        Id.extend({
          name: z.string().min(1).max(120).optional(),
          slug: z.string().max(120).optional(),
          parentId: z.string().uuid().nullable().optional(),
          description: z.string().max(300).nullable().optional(),
          imageMediaId: z.string().uuid().nullable().optional(),
          isActive: z.boolean().optional(),
          seo: BlogSeo.nullable().optional(),
        }),
      )
      .output(Ok),
    reorder: oc
      .route({ method: "POST", path: "/admin/blog/categories/reorder" })
      .input(z.object({ orderedIds: z.array(z.string().uuid()).max(500) }))
      .output(Ok),
    delete: oc
      .route({ method: "DELETE", path: "/admin/blog/categories/{id}" })
      .input(Id.extend({ moveTo: z.string().uuid().nullable().optional() }))
      .output(Ok),
  },
  posts: {
    list: oc
      .route({ method: "GET", path: "/admin/blog/posts" })
      .input(
        z
          .object({
            search: z.string().max(200).optional(),
            status: BlogPostStatus.optional(),
            categoryId: z.string().uuid().optional(),
            sort: z.enum(["updated_desc", "published_desc", "title_asc"]).optional(),
            limit: z.coerce.number().int().min(1).max(100).optional(),
            offset: z.coerce.number().int().min(0).optional(),
          })
          .optional(),
      )
      .output(z.object({ items: z.array(BlogPostListItem), total: z.number().int() })),
    get: oc.route({ method: "GET", path: "/admin/blog/posts/{id}" }).input(Id).output(BlogPostDetail),
    create: oc
      .route({ method: "POST", path: "/admin/blog/posts" })
      .input(z.object(PostFields))
      .output(z.object({ id: z.string().uuid(), slug: z.string(), status: BlogPostStatus })),
    update: oc
      .route({ method: "PATCH", path: "/admin/blog/posts/{id}" })
      .input(z.object(PostFields).partial().extend({ id: z.string().uuid() }))
      .output(z.object({ slug: z.string(), status: BlogPostStatus })),
    publish: oc
      .route({ method: "POST", path: "/admin/blog/posts/{id}/publish" })
      .input(Id)
      .output(z.object({ slug: z.string(), status: BlogPostStatus })),
    schedule: oc
      .route({ method: "POST", path: "/admin/blog/posts/{id}/schedule" })
      .input(Id.extend({ publishedAt: z.string().datetime({ offset: true }) }))
      .output(z.object({ slug: z.string(), status: BlogPostStatus })),
    unpublish: oc
      .route({ method: "POST", path: "/admin/blog/posts/{id}/unpublish" })
      .input(Id)
      .output(z.object({ slug: z.string(), status: BlogPostStatus })),
    duplicate: oc
      .route({ method: "POST", path: "/admin/blog/posts/{id}/duplicate" })
      .input(Id)
      .output(z.object({ id: z.string().uuid(), slug: z.string() })),
    delete: oc.route({ method: "DELETE", path: "/admin/blog/posts/{id}" }).input(Id).output(Ok),
    /** A signed link (valid 24 hours) that shows the post on the storefront whatever its state, hidden from search engines. */
    previewLink: oc
      .route({ method: "POST", path: "/admin/blog/posts/{id}/preview-link" })
      .input(Id)
      .output(z.object({ url: z.string(), expiresAt: z.string() })),
    /** The sanitised HTML the shopper would get for an unsaved body, so the admin preview equals the storefront. */
    previewHtml: oc
      .route({ method: "POST", path: "/admin/blog/preview-html" })
      .input(z.object({ contentHtml: z.string().max(200_000) }))
      .output(
        z.object({
          html: z.string(),
          readingMinutes: z.number().int(),
          headings: z.array(z.object({ id: z.string(), text: z.string(), level: z.number().int() })),
        }),
      ),
  },
  settings: {
    get: oc.route({ method: "GET", path: "/admin/blog/settings" }).output(BlogSettings),
    update: oc
      .route({ method: "PATCH", path: "/admin/blog/settings" })
      .input(BlogSettings.partial())
      .output(BlogSettings),
  },
};
