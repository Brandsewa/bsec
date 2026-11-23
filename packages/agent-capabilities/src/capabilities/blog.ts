import { z } from "zod";
import {
  createBlogCategory,
  createBlogPost,
  deleteBlogCategory,
  deleteBlogPost,
  duplicateBlogPost,
  getBlogPost,
  listBlogCategories,
  listBlogPosts,
  publishBlogPost,
  unpublishBlogPost,
  updateBlogCategory,
  updateBlogPost,
  writeAgentAudit,
} from "@bs/domain";
import { CapabilityError } from "../errors.ts";
import { pageInput, pageParams, toPage } from "../shape.ts";
import { defineCapability, type CapabilityEnv } from "../types.ts";
import { Confirm, Id, plain, requirePublishing } from "./content-shared.ts";

type Post = NonNullable<Awaited<ReturnType<typeof getBlogPost>>>;

const BODY_READ_CHARS = 15_000;

function shapePost(p: Post, bodyFrom = 0) {
  const body = p.contentHtml ?? "";
  const seo = (p.seo ?? {}) as { title?: string | null; description?: string | null; noindex?: boolean };
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    status: p.status,
    publishedAt: p.publishedAt,
    excerpt: p.excerpt,
    authorName: p.authorName,
    categoryId: p.categoryId,
    isFeatured: p.isFeatured,
    featuredImageMediaId: p.featuredImageMediaId,
    featuredImageAlt: p.featuredImageAlt,
    seoTitle: seo.title,
    seoDescription: seo.description,
    noindex: seo.noindex,
    readingMinutes: p.readingMinutes,
    contentLength: body.length,
    contentHtml: body.slice(bodyFrom, bodyFrom + BODY_READ_CHARS),
    ...(body.length > bodyFrom + BODY_READ_CHARS ? { contentTruncated: true, nextBodyFrom: bodyFrom + BODY_READ_CHARS } : {}),
    updatedAt: p.updatedAt,
  };
}

async function loadPost(env: CapabilityEnv, id: string): Promise<Post> {
  const post = await getBlogPost(env.rt, env.session.ctx, id);
  if (!post) throw new CapabilityError("not_found", "That blog post was not found.");
  return post;
}

const BlogSlug = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.");

const PostFields = {
  slug: BlogSlug.optional().describe("Web address part. Changing it on a post that is live keeps the old address working (a redirect is added)."),
  excerpt: z.string().max(400).optional().describe("Short plain-text summary shown on blog cards. Empty text clears it."),
  contentHtml: z
    .string()
    .max(200_000)
    .optional()
    .describe("The post body as simple HTML: p, h2-h4, ul, ol, li, strong, em, a (https or / links), blockquote, br, hr, img (library images only). Anything else is removed by the store's safe-text filter. No scripts or styles."),
  featuredImageMediaId: Id.nullable().optional().describe("A media library image for the post (find ids with list_media). null removes it."),
  featuredImageAlt: z.string().max(300).optional().describe("Alt text for the featured image."),
  categoryId: Id.nullable().optional().describe("A blog category (list_blog_categories). null removes the category."),
  authorName: z.string().min(1).max(120).optional().describe("Shown as the author. Defaults to the person who connected the AI app."),
  isFeatured: z.boolean().optional(),
  seoTitle: z.string().max(70).optional(),
  seoDescription: z.string().max(170).optional(),
  noindex: z.boolean().optional().describe("true asks search engines not to list the post."),
};

function seoFrom(current: Post["seo"] | null, input: { seoTitle?: string | undefined; seoDescription?: string | undefined; noindex?: boolean | undefined }) {
  if (input.seoTitle === undefined && input.seoDescription === undefined && input.noindex === undefined) return undefined;
  return {
    ...(current ?? {}),
    ...(input.seoTitle !== undefined ? { title: input.seoTitle } : {}),
    ...(input.seoDescription !== undefined ? { description: input.seoDescription } : {}),
    ...(input.noindex !== undefined ? { noindex: input.noindex } : {}),
  };
}

export const listBlogPostsCap = defineCapability({
  name: "list_blog_posts",
  title: "List blog posts",
  description: "Blog posts with status (draft, scheduled, published), category and dates. Use get_blog_post for one post's text.",
  resource: "blog",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({
    search: z.string().max(100).optional().describe("Part of the title."),
    status: z.enum(["draft", "scheduled", "published"]).optional(),
    categoryId: Id.optional(),
    ...pageInput,
  }),
  async handler({ rt, session }, input) {
    const { limit, offset } = pageParams(input);
    const r = await listBlogPosts(rt, session.ctx, {
      limit,
      offset,
      ...(input.search ? { search: input.search } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    });
    const items = r.items.map((p) => ({ id: p.id, title: p.title, slug: p.slug, status: p.status, publishedAt: p.publishedAt, updatedAt: p.updatedAt, authorName: p.authorName, categoryId: p.categoryId, categoryName: p.categoryName, isFeatured: p.isFeatured }));
    return { counts: r.counts, ...toPage(items, r.total, offset, limit) };
  },
});

export const getBlogPostCap = defineCapability({
  name: "get_blog_post",
  title: "Get a blog post",
  description: `One blog post with its settings and body HTML (the first ${BODY_READ_CHARS} characters; pass bodyFrom to read on).`,
  resource: "blog",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ id: Id, bodyFrom: z.number().int().min(0).max(1_000_000).optional() }),
  async handler(env, input) {
    return shapePost(await loadPost(env, input.id), input.bodyFrom ?? 0);
  },
});

export const createBlogPostCap = defineCapability({
  name: "create_blog_post",
  title: "Write a blog post (draft)",
  description: "Creates a blog post as a DRAFT that shoppers cannot see. Publish it later with publish_blog_post.",
  resource: "blog",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({ title: z.string().min(1).max(200), ...PostFields }),
  async handler(env: CapabilityEnv, input) {
    const seo = seoFrom(null, input);
    const created = await createBlogPost(env.rt, env.session.ctx, {
      title: input.title,
      status: "draft",
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.excerpt ? { excerpt: plain(input.excerpt) } : {}),
      ...(input.contentHtml !== undefined ? { contentHtml: input.contentHtml } : {}),
      ...(input.featuredImageMediaId !== undefined ? { featuredImageMediaId: input.featuredImageMediaId } : {}),
      ...(input.featuredImageAlt !== undefined ? { featuredImageAlt: input.featuredImageAlt } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.authorName ? { authorName: input.authorName } : {}),
      ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
      ...(seo ? { seo } : {}),
    });
    const after = shapePost(await loadPost(env, created.id));
    await writeAgentAudit(env.rt, env.session, { action: "blog.post.created", targetType: "blog_post", targetId: created.id, after: { ...after, contentHtml: undefined } });
    return after;
  },
});

export const updateBlogPostCap = defineCapability({
  name: "update_blog_post",
  title: "Edit a blog post",
  description: "Changes only the fields you pass. This does not change whether the post is published (use publish_blog_post and unpublish_blog_post). Editing a post that is already live changes what shoppers read.",
  resource: "blog",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id, title: z.string().min(1).max(200).optional(), ...PostFields }),
  async handler(env: CapabilityEnv, input) {
    const before = await loadPost(env, input.id);
    const seo = seoFrom(before.seo, input);
    await updateBlogPost(env.rt, env.session.ctx, input.id, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.excerpt !== undefined ? { excerpt: input.excerpt === "" ? null : plain(input.excerpt) } : {}),
      ...(input.contentHtml !== undefined ? { contentHtml: input.contentHtml } : {}),
      ...(input.featuredImageMediaId !== undefined ? { featuredImageMediaId: input.featuredImageMediaId } : {}),
      ...(input.featuredImageAlt !== undefined ? { featuredImageAlt: input.featuredImageAlt } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.authorName !== undefined ? { authorName: input.authorName } : {}),
      ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
      ...(seo ? { seo } : {}),
    });
    const after = shapePost(await loadPost(env, input.id));
    await writeAgentAudit(env.rt, env.session, {
      action: "blog.post.updated",
      targetType: "blog_post",
      targetId: input.id,
      before: { ...shapePost(before), contentHtml: input.contentHtml !== undefined ? before.contentHtml?.slice(0, 2000) : undefined },
      after: { ...after, contentHtml: input.contentHtml !== undefined ? after.contentHtml.slice(0, 2000) : undefined },
    });
    return after;
  },
});

export const publishBlogPostCap = defineCapability({
  name: "publish_blog_post",
  title: "Publish or schedule a blog post",
  description: "Makes the post visible to shoppers now, or at publishAt if that is a future date (then it is scheduled). Needs the store's Allow publishing switch.",
  resource: "blog",
  action: "write",
  kind: "write",
  publishes: true,
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id, publishAt: z.string().datetime({ offset: true }).optional().describe("ISO date and time, for example 2026-12-01T09:00:00+05:30. Omit to publish now.") }),
  async handler(env: CapabilityEnv, input) {
    requirePublishing(env.session.settings.allowPublishing, "the blog post");
    const before = await loadPost(env, input.id);
    await publishBlogPost(env.rt, env.session.ctx, input.id, input.publishAt ?? null);
    const after = await loadPost(env, input.id);
    await writeAgentAudit(env.rt, env.session, { action: "blog.post.published", targetType: "blog_post", targetId: input.id, before: { status: before.status, publishedAt: before.publishedAt }, after: { status: after.status, publishedAt: after.publishedAt } });
    return { id: input.id, title: after.title, status: after.status, publishedAt: after.publishedAt };
  },
});

export const unpublishBlogPostCap = defineCapability({
  name: "unpublish_blog_post",
  title: "Unpublish a blog post",
  description: "Takes the post off the blog and makes it a draft again. The text is kept.",
  resource: "blog",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id }),
  async handler(env: CapabilityEnv, input) {
    const before = await loadPost(env, input.id);
    await unpublishBlogPost(env.rt, env.session.ctx, input.id);
    await writeAgentAudit(env.rt, env.session, { action: "blog.post.unpublished", targetType: "blog_post", targetId: input.id, before: { status: before.status }, after: { status: "draft" } });
    return { id: input.id, title: before.title, status: "draft" };
  },
});

export const duplicateBlogPostCap = defineCapability({
  name: "duplicate_blog_post",
  title: "Copy a blog post (draft)",
  description: "Makes a draft copy of a post, titled \"Copy of ...\", so it can be reworked without touching the original.",
  resource: "blog",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({ id: Id }),
  async handler(env: CapabilityEnv, input) {
    const created = await duplicateBlogPost(env.rt, env.session.ctx, input.id);
    await writeAgentAudit(env.rt, env.session, { action: "blog.post.created", targetType: "blog_post", targetId: created.id, after: { copiedFrom: input.id } });
    return { id: created.id, slug: created.slug, status: "draft" };
  },
});

export const deleteBlogPostCap = defineCapability({
  name: "delete_blog_post",
  title: "Delete a blog post",
  description: "Permanently deletes a blog post. Only a draft can be deleted: unpublish a live or scheduled post first. Requires confirm: true. Deleting cannot be undone.",
  resource: "blog",
  action: "delete",
  kind: "write",
  annotations: { readOnly: false, destructive: true, idempotent: false },
  input: z.object({ id: Id, confirm: Confirm }),
  async handler(env: CapabilityEnv, input) {
    const before = await loadPost(env, input.id);
    if (before.status !== "draft") throw new CapabilityError("invalid_input", `This post is ${before.status}. Unpublish it first (unpublish_blog_post), then delete it.`);
    await deleteBlogPost(env.rt, env.session.ctx, input.id);
    await writeAgentAudit(env.rt, env.session, { action: "blog.post.deleted", targetType: "blog_post", targetId: input.id, before: { title: before.title, slug: before.slug } });
    return { deleted: true, id: input.id, title: before.title };
  },
});

// ---------------------------------------------------------------- blog categories

const CategoryFields = {
  slug: BlogSlug.optional(),
  parentId: Id.nullable().optional().describe("A parent blog category, or null for a top-level one."),
  description: z.string().max(300).optional().describe("Plain text. Empty text clears it."),
  imageMediaId: Id.nullable().optional(),
  isActive: z.boolean().optional().describe("false hides the category on the blog."),
  seoTitle: z.string().max(70).optional(),
  seoDescription: z.string().max(170).optional(),
};

function categorySeo(input: { seoTitle?: string | undefined; seoDescription?: string | undefined }) {
  if (input.seoTitle === undefined && input.seoDescription === undefined) return undefined;
  return { ...(input.seoTitle !== undefined ? { title: input.seoTitle } : {}), ...(input.seoDescription !== undefined ? { description: input.seoDescription } : {}) };
}

export const listBlogCategoriesCap = defineCapability({
  name: "list_blog_categories",
  title: "List blog categories",
  description: "The blog's categories as a tree (top level with their children), with post counts.",
  resource: "blog",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({}),
  async handler({ rt, session }) {
    const roots = await listBlogCategories(rt, session.ctx);
    const slim = (c: (typeof roots)[number]): unknown => ({ id: c.id, name: c.name, slug: c.slug, parentId: c.parentId, isActive: c.isActive, postCount: c.postCount, ...(c.children?.length ? { children: c.children.map(slim) } : {}) });
    return roots.map(slim);
  },
});

export const createBlogCategoryCap = defineCapability({
  name: "create_blog_category",
  title: "Create a blog category",
  description: "Adds a category to the blog.",
  resource: "blog",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({ name: z.string().min(1).max(120), ...CategoryFields }),
  async handler(env: CapabilityEnv, input) {
    const seo = categorySeo(input);
    const created = await createBlogCategory(env.rt, env.session.ctx, {
      name: input.name,
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.description ? { description: plain(input.description) } : {}),
      ...(input.imageMediaId !== undefined ? { imageMediaId: input.imageMediaId } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(seo ? { seo } : {}),
    });
    await writeAgentAudit(env.rt, env.session, { action: "blog.category.created", targetType: "blog_category", targetId: created.id, after: { name: input.name, slug: created.slug } });
    return { id: created.id, slug: created.slug, name: input.name };
  },
});

export const updateBlogCategoryCap = defineCapability({
  name: "update_blog_category",
  title: "Edit a blog category",
  description: "Changes only the fields you pass.",
  resource: "blog",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id, name: z.string().min(1).max(120).optional(), ...CategoryFields }),
  async handler(env: CapabilityEnv, input) {
    const seo = categorySeo(input);
    await updateBlogCategory(env.rt, env.session.ctx, input.id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.description !== undefined ? { description: input.description === "" ? null : plain(input.description) } : {}),
      ...(input.imageMediaId !== undefined ? { imageMediaId: input.imageMediaId } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(seo ? { seo } : {}),
    });
    await writeAgentAudit(env.rt, env.session, { action: "blog.category.updated", targetType: "blog_category", targetId: input.id, after: { ...input } });
    return { id: input.id, updated: true };
  },
});

export const deleteBlogCategoryCap = defineCapability({
  name: "delete_blog_category",
  title: "Delete a blog category",
  description:
    "Permanently deletes a blog category. Its posts are not deleted: they move to moveToCategoryId, or become uncategorised when you omit it. Its sub-categories become top-level. Requires confirm: true.",
  resource: "blog",
  action: "delete",
  kind: "write",
  annotations: { readOnly: false, destructive: true, idempotent: false },
  input: z.object({ id: Id, moveToCategoryId: Id.optional(), confirm: Confirm }),
  async handler(env: CapabilityEnv, input) {
    await deleteBlogCategory(env.rt, env.session.ctx, input.id, input.moveToCategoryId ?? null);
    await writeAgentAudit(env.rt, env.session, { action: "blog.category.deleted", targetType: "blog_category", targetId: input.id, after: { movedPostsTo: input.moveToCategoryId ?? null } });
    return { deleted: true, id: input.id };
  },
});

export const blogCapabilities = [
  listBlogPostsCap,
  getBlogPostCap,
  createBlogPostCap,
  updateBlogPostCap,
  publishBlogPostCap,
  unpublishBlogPostCap,
  duplicateBlogPostCap,
  deleteBlogPostCap,
  listBlogCategoriesCap,
  createBlogCategoryCap,
  updateBlogCategoryCap,
  deleteBlogCategoryCap,
];
