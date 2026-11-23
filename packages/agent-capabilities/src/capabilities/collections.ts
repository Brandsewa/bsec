import { z } from "zod";
import { createCollection, deleteCollection, getCollection, listCollections, updateCollection, writeAgentAudit } from "@bs/domain";
import { CapabilityError } from "../errors.ts";
import { defineCapability, type CapabilityEnv } from "../types.ts";
import { Confirm, Id, ProductRule, SeoFields, SortOrder, plain, requirePublishing, seoPatch } from "./content-shared.ts";

type CollectionDetail = Awaited<ReturnType<typeof getCollection>>;

function shapeCollection(c: CollectionDetail, withProducts = true) {
  const seo = (c.seo ?? {}) as { title?: string | null; description?: string | null };
  const products = (c as { products?: Array<{ id: string; title: string; status: string }> }).products ?? [];
  return {
    id: c.id,
    title: c.title,
    slug: c.slug,
    description: c.description,
    published: c.published,
    indexable: c.indexable,
    type: c.type,
    match: c.match,
    rules: c.rules,
    sortOrder: c.sortOrder,
    imageMediaId: c.imageMediaId,
    seoTitle: seo.title,
    seoDescription: seo.description,
    productCount: (c as { productCount?: number }).productCount,
    ...(withProducts ? { products: products.slice(0, 40).map((p) => ({ id: p.id, title: p.title, status: p.status })) } : {}),
  };
}

export const listCollectionsCap = defineCapability({
  name: "list_collections",
  title: "List collections",
  description: "The store's collections with their ids and whether they are published.",
  resource: "collections",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ search: z.string().max(100).optional(), status: z.enum(["active", "draft"]).optional().describe("active = published, draft = not published") }),
  async handler({ rt, session }, input) {
    const rows = await listCollections(rt, session.ctx, { ...(input.search ? { search: input.search } : {}), ...(input.status ? { status: input.status } : {}) });
    return rows.slice(0, 50).map((c) => ({ id: c.id, title: c.title, slug: c.slug, published: c.published, type: c.type, productCount: c.productCount }));
  },
});

export const getCollectionCap = defineCapability({
  name: "get_collection",
  title: "Get a collection",
  description: "One collection with all its settings (description, SEO, rules for automated collections, sort order) and its first 40 products.",
  resource: "collections",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ id: Id }),
  async handler({ rt, session }, input) {
    return shapeCollection(await getCollection(rt, session.ctx, { id: input.id }));
  },
});

const CollectionFields = {
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.").optional().describe("Web address part. Changing it changes the collection's URL."),
  description: z.string().max(300).optional().describe("Plain text, at most 300 characters. Empty text clears it."),
  imageMediaId: Id.nullable().optional().describe("A media library image (find ids with list_media). null removes the image."),
  type: z.enum(["manual", "automated"]).optional().describe("Manual collections hold the products you choose. Automated collections pick products by rules."),
  match: z.enum(["all", "any"]).optional().describe("For automated collections: all rules must match, or any."),
  rules: z.array(ProductRule).max(20).optional().describe("Rules for an automated collection."),
  sortOrder: SortOrder.optional(),
  indexable: z.boolean().optional().describe("false asks search engines not to list the page."),
  productIds: z.array(Id).max(500).optional().describe("Manual collections only: replaces the products with exactly this ordered list. To add or remove a few, use set_collection_products."),
  ...SeoFields,
};

export const createCollectionCap = defineCapability({
  name: "create_collection",
  title: "Create a collection (unpublished)",
  description: "Creates a collection that is not visible to shoppers yet. Publish it later with update_collection (needs the store's Allow publishing switch).",
  resource: "collections",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({ title: z.string().min(1).max(120), ...CollectionFields }),
  async handler(env: CapabilityEnv, input) {
    const seo = seoPatch(null, input);
    const created = await createCollection(env.rt, env.session.ctx, {
      title: input.title,
      published: false,
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.description ? { description: plain(input.description) } : {}),
      ...(input.imageMediaId !== undefined ? { imageMediaId: input.imageMediaId } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.match ? { match: input.match } : {}),
      ...(input.rules ? { rules: input.rules } : {}),
      ...(input.sortOrder ? { sortOrder: input.sortOrder } : {}),
      ...(input.indexable !== undefined ? { indexable: input.indexable } : {}),
      ...(input.productIds ? { productIds: input.productIds } : {}),
      ...(seo ? { seo } : {}),
    });
    const after = shapeCollection(created);
    await writeAgentAudit(env.rt, env.session, { action: "collection.created", targetType: "collection", targetId: after.id, after });
    return after;
  },
});

export const updateCollectionCap = defineCapability({
  name: "update_collection",
  title: "Edit a collection",
  description: "Changes only the fields you pass. published true makes the collection visible to shoppers and needs the store's Allow publishing switch; published false hides it.",
  resource: "collections",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id, title: z.string().min(1).max(120).optional(), published: z.boolean().optional(), ...CollectionFields }),
  async handler(env: CapabilityEnv, input) {
    if (input.published === true) requirePublishing(env.session.settings.allowPublishing, "the collection");
    const before = await getCollection(env.rt, env.session.ctx, { id: input.id });
    const seo = seoPatch(before.seo, input);
    const updated = await updateCollection(env.rt, env.session.ctx, {
      id: input.id,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.description !== undefined ? { description: input.description === "" ? null : plain(input.description) } : {}),
      ...(input.imageMediaId !== undefined ? { imageMediaId: input.imageMediaId } : {}),
      ...(input.type ? { type: input.type } : {}),
      ...(input.match ? { match: input.match } : {}),
      ...(input.rules ? { rules: input.rules } : {}),
      ...(input.sortOrder ? { sortOrder: input.sortOrder } : {}),
      ...(input.indexable !== undefined ? { indexable: input.indexable } : {}),
      ...(input.published !== undefined ? { published: input.published } : {}),
      ...(input.productIds ? { productIds: input.productIds } : {}),
      ...(seo ? { seo } : {}),
    });
    const after = shapeCollection(updated);
    await writeAgentAudit(env.rt, env.session, { action: "collection.updated", targetType: "collection", targetId: input.id, before: shapeCollection(before, false), after });
    return after;
  },
});

export const setCollectionProductsCap = defineCapability({
  name: "set_collection_products",
  title: "Add or remove products in a collection",
  description: "For a manual collection: add products, remove products, or replace the whole list. Find product ids with list_products. Automated collections pick products by rules, so change those with update_collection.",
  resource: "collections",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id, mode: z.enum(["add", "remove", "replace"]), productIds: z.array(Id).max(500) }),
  async handler(env: CapabilityEnv, input) {
    const before = await getCollection(env.rt, env.session.ctx, { id: input.id });
    if (before.type === "automated") throw new CapabilityError("invalid_input", "This collection picks its products by rules. Change its rules with update_collection, or turn it into a manual collection first.");
    const current = ((before as { productIds?: string[] }).productIds ?? []) as string[];
    const wanted = new Set(input.productIds);
    const next = input.mode === "replace" ? [...new Set(input.productIds)] : input.mode === "add" ? [...current, ...input.productIds.filter((p) => !current.includes(p))] : current.filter((p) => !wanted.has(p));
    const updated = await updateCollection(env.rt, env.session.ctx, { id: input.id, productIds: next });
    const after = shapeCollection(updated, false);
    await writeAgentAudit(env.rt, env.session, {
      action: "collection.updated",
      targetType: "collection",
      targetId: input.id,
      before: { productCount: current.length },
      after: { productCount: after.productCount, mode: input.mode, changed: input.productIds.length },
    });
    return { id: input.id, title: after.title, productCount: after.productCount };
  },
});

export const deleteCollectionCap = defineCapability({
  name: "delete_collection",
  title: "Delete a collection",
  description:
    "Permanently deletes a collection (the products in it are not deleted). Only a collection that is not published can be deleted: unpublish it first with update_collection. Requires confirm: true. Deleting cannot be undone.",
  resource: "collections",
  action: "delete",
  kind: "write",
  annotations: { readOnly: false, destructive: true, idempotent: false },
  input: z.object({ id: Id, confirm: Confirm }),
  async handler(env: CapabilityEnv, input) {
    const before = await getCollection(env.rt, env.session.ctx, { id: input.id });
    if (before.published) throw new CapabilityError("invalid_input", "This collection is visible to shoppers. Unpublish it first (update_collection with published false), then delete it.");
    await deleteCollection(env.rt, env.session.ctx, { id: input.id });
    await writeAgentAudit(env.rt, env.session, { action: "collection.deleted", targetType: "collection", targetId: input.id, before: shapeCollection(before, false) });
    return { deleted: true, id: input.id, title: before.title };
  },
});

export const collectionCapabilities = [listCollectionsCap, getCollectionCap, createCollectionCap, updateCollectionCap, setCollectionProductsCap, deleteCollectionCap];
