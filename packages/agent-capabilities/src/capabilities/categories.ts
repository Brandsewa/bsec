import { z } from "zod";
import { createCategory, deleteCategory, getCategory, updateCategory, writeAgentAudit } from "@bs/domain";
import { CapabilityError } from "../errors.ts";
import { defineCapability, type CapabilityEnv } from "../types.ts";
import { Confirm, Id, ProductRule, SeoFields, SortOrder, plain, requirePublishing, seoPatch } from "./content-shared.ts";

type CategoryDetail = Awaited<ReturnType<typeof getCategory>>;

function shapeCategory(c: CategoryDetail, withProducts = true) {
  const seo = (c.seo ?? {}) as { title?: string | null; description?: string | null };
  const products = (c as { products?: Array<{ id: string; title: string; status: string }> }).products ?? [];
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    parentId: c.parentId,
    path: c.path,
    description: c.description,
    isActive: c.isActive,
    isFeatured: c.isFeatured,
    position: c.position,
    type: c.type,
    match: c.match,
    rules: c.rules,
    sortOrder: c.sortOrder,
    imageMediaId: c.imageMediaId,
    seoTitle: seo.title,
    seoDescription: seo.description,
    productCount: products.length,
    ...(withProducts ? { products: products.slice(0, 40).map((p) => ({ id: p.id, title: p.title, status: p.status })) } : {}),
  };
}

export const getCategoryCap = defineCapability({
  name: "get_category",
  title: "Get a category",
  description: "One category with its settings, SEO fields, rules (for automated categories) and the first 40 products in it. Use list_categories to find ids.",
  resource: "categories",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ id: Id }),
  async handler({ rt, session }, input) {
    return shapeCategory(await getCategory(rt, session.ctx, { id: input.id }));
  },
});

const CategoryFields = {
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.").optional().describe("Web address part. Changing it changes the category's URL."),
  description: z.string().max(1000).optional().describe("Plain text shown on the category page. Empty text clears it."),
  parentId: Id.nullable().optional().describe("The parent category (categories can be nested up to 3 levels). null makes it a top-level category."),
  imageMediaId: Id.nullable().optional().describe("A media library image (find ids with list_media). null removes the image."),
  position: z.number().int().min(0).max(10000).optional().describe("Order among its siblings, lowest first."),
  isFeatured: z.boolean().optional(),
  type: z.enum(["manual", "automated"]).optional().describe("Manual categories hold the products you assign. Automated categories pick products by rules."),
  match: z.enum(["all", "any"]).optional().describe("For automated categories: all rules must match, or any."),
  rules: z.array(ProductRule).max(20).optional().describe("Rules for an automated category."),
  sortOrder: SortOrder.optional(),
  productIds: z.array(Id).max(500).optional().describe("Manual categories only: replaces the products in the category with exactly this ordered list. A product whose primary category is this one cannot be removed this way."),
  ...SeoFields,
};

export const createCategoryCap = defineCapability({
  name: "create_category",
  title: "Create a category (inactive)",
  description: "Creates a category that is NOT visible to shoppers yet (inactive). Turn it on with update_category (isActive true needs the store's Allow publishing switch).",
  resource: "categories",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({ name: z.string().min(1).max(120), ...CategoryFields }),
  async handler(env: CapabilityEnv, input) {
    const seo = seoPatch(null, input);
    const created = await createCategory(env.rt, env.session.ctx, {
      name: input.name,
      isActive: false,
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.description ? { description: plain(input.description) } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.imageMediaId !== undefined ? { imageMediaId: input.imageMediaId } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.match ? { match: input.match } : {}),
      ...(input.rules ? { rules: input.rules } : {}),
      ...(input.sortOrder ? { sortOrder: input.sortOrder } : {}),
      ...(input.productIds ? { productIds: input.productIds } : {}),
      ...(seo ? { seo } : {}),
    });
    const after = shapeCategory(created);
    await writeAgentAudit(env.rt, env.session, { action: "category.created", targetType: "category", targetId: after.id, after });
    return after;
  },
});

export const updateCategoryCap = defineCapability({
  name: "update_category",
  title: "Edit a category",
  description: "Changes only the fields you pass. isActive true shows the category to shoppers and needs the store's Allow publishing switch; isActive false hides it.",
  resource: "categories",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id, name: z.string().min(1).max(120).optional(), isActive: z.boolean().optional().describe("true shows it to shoppers, false hides it."), ...CategoryFields }),
  async handler(env: CapabilityEnv, input) {
    if (input.isActive === true) requirePublishing(env.session.settings.allowPublishing, "the category");
    const before = await getCategory(env.rt, env.session.ctx, { id: input.id });
    const seo = seoPatch(before.seo, input);
    const updated = await updateCategory(env.rt, env.session.ctx, {
      id: input.id,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.description !== undefined ? { description: input.description === "" ? null : plain(input.description) } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.imageMediaId !== undefined ? { imageMediaId: input.imageMediaId } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.match ? { match: input.match } : {}),
      ...(input.rules ? { rules: input.rules } : {}),
      ...(input.sortOrder ? { sortOrder: input.sortOrder } : {}),
      ...(input.productIds ? { productIds: input.productIds } : {}),
      ...(seo ? { seo } : {}),
    });
    const after = shapeCategory(updated);
    await writeAgentAudit(env.rt, env.session, { action: "category.updated", targetType: "category", targetId: input.id, before: shapeCategory(before, false), after });
    return after;
  },
});

export const deleteCategoryCap = defineCapability({
  name: "delete_category",
  title: "Delete a category",
  description:
    "Permanently deletes a category. Only an inactive (hidden) category with no sub-categories and no products can be deleted: the store refuses otherwise, and you should move or remove those first. Requires confirm: true. Deleting cannot be undone.",
  resource: "categories",
  action: "delete",
  kind: "write",
  annotations: { readOnly: false, destructive: true, idempotent: false },
  input: z.object({ id: Id, confirm: Confirm }),
  async handler(env: CapabilityEnv, input) {
    const before = await getCategory(env.rt, env.session.ctx, { id: input.id });
    if (before.isActive) {
      throw new CapabilityError("invalid_input", "This category is visible to shoppers. Hide it first (update_category with isActive false), then delete it.");
    }
    try {
      await deleteCategory(env.rt, env.session.ctx, { id: input.id });
    } catch (err) {
      // The store's own refusals ("has subcategories", "products are assigned") are safe to relay as they are.
      if (err instanceof Error && /^Cannot delete category/.test(err.message)) throw new CapabilityError("invalid_input", err.message);
      throw err;
    }
    await writeAgentAudit(env.rt, env.session, { action: "category.deleted", targetType: "category", targetId: input.id, before: shapeCategory(before, false) });
    return { deleted: true, id: input.id, name: before.name };
  },
});

export const categoryCapabilities = [getCategoryCap, createCategoryCap, updateCategoryCap, deleteCategoryCap];
