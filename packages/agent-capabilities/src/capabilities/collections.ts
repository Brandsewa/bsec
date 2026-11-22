import { z } from "zod";
import { createCollection, getCollection, listCollections, updateCollection, writeAgentAudit } from "@bs/domain";
import { CapabilityError } from "../errors.ts";
import { defineCapability, type CapabilityEnv } from "../types.ts";

const Id = z.string().uuid();

type CollectionDetail = Awaited<ReturnType<typeof getCollection>>;

function shapeCollection(c: CollectionDetail) {
  const seo = (c.seo ?? {}) as { title?: string | null; description?: string | null };
  return {
    id: c.id,
    title: c.title,
    slug: c.slug,
    description: c.description,
    published: c.published,
    type: c.type,
    seoTitle: seo.title,
    seoDescription: seo.description,
    productCount: (c as { productCount?: number }).productCount,
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
  description: "One collection with its description and SEO title and description.",
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

function plain(text: string): string {
  if (/[<>]/.test(text)) throw new CapabilityError("invalid_input", "Descriptions are plain text. Remove any HTML characters (< and >).");
  return text;
}

export const createCollectionCap = defineCapability({
  name: "create_collection",
  title: "Create a collection (unpublished)",
  description: "Creates an empty manual collection that is not visible to shoppers yet. The description is plain text, at most 300 characters.",
  resource: "collections",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({
    title: z.string().min(1).max(120),
    description: z.string().max(300).optional(),
    seoTitle: z.string().max(70).optional(),
    seoDescription: z.string().max(170).optional(),
  }),
  async handler(env: CapabilityEnv, input) {
    const created = await createCollection(env.rt, env.session.ctx, {
      title: input.title,
      type: "manual",
      published: false,
      ...(input.description ? { description: plain(input.description) } : {}),
      ...(input.seoTitle || input.seoDescription ? { seo: { title: input.seoTitle ?? null, description: input.seoDescription ?? null } } : {}),
    });
    const after = shapeCollection(created);
    await writeAgentAudit(env.rt, env.session, { action: "collection.created", targetType: "collection", targetId: after.id, after });
    return after;
  },
});

export const updateCollectionCap = defineCapability({
  name: "update_collection",
  title: "Edit a collection",
  description: "Changes the collection fields you pass: title, description (plain text, at most 300 characters), SEO title and description. Setting published to true makes it visible to shoppers and needs the store's Allow publishing switch.",
  resource: "collections",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({
    id: Id,
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(300).optional(),
    seoTitle: z.string().max(70).optional(),
    seoDescription: z.string().max(170).optional(),
    published: z.boolean().optional(),
  }),
  async handler(env: CapabilityEnv, input) {
    if (input.published === true && !env.session.settings.allowPublishing) {
      throw new CapabilityError("forbidden", "This store has not allowed AI apps to publish. The store owner can turn on Allow publishing in Settings > AI access > Permissions.");
    }
    const before = await getCollection(env.rt, env.session.ctx, { id: input.id });
    const currentSeo = (before.seo ?? {}) as { title?: string | null; description?: string | null };
    const seoChanged = input.seoTitle !== undefined || input.seoDescription !== undefined;
    const updated = await updateCollection(env.rt, env.session.ctx, {
      id: input.id,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: plain(input.description) } : {}),
      ...(input.published !== undefined ? { published: input.published } : {}),
      ...(seoChanged ? { seo: { title: input.seoTitle ?? currentSeo.title ?? null, description: input.seoDescription ?? currentSeo.description ?? null } } : {}),
    });
    const after = shapeCollection(updated);
    await writeAgentAudit(env.rt, env.session, { action: "collection.updated", targetType: "collection", targetId: input.id, before: shapeCollection(before), after });
    return after;
  },
});

export const collectionCapabilities = [listCollectionsCap, getCollectionCap, createCollectionCap, updateCollectionCap];
