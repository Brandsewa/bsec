import { z } from "zod";
import {
  BlockEditError,
  createPage,
  deletePage,
  describeBlockType,
  findBlock,
  getPage,
  insertBlock,
  listPages,
  moveBlock,
  newBlock,
  outlineBlocks,
  patchBlockProps,
  publishPage,
  removeBlock,
  savePageDraft,
  setBlockHidden,
  shallowBlock,
  storeBlockTypes,
  unpublishPage,
  updatePage,
  writeAgentAudit,
} from "@bs/domain";
import { CapabilityError } from "../errors.ts";
import { defineCapability, type CapabilityEnv } from "../types.ts";
import { Confirm, Id, requirePublishing } from "./content-shared.ts";

type BlockList = Parameters<typeof insertBlock>[0];
type PageDetail = Awaited<ReturnType<typeof getPage>>;

const PageSlug = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.");
const BlockId = z.string().min(1).max(100).describe("A block id from get_page.");

function shapePage(p: PageDetail) {
  const seo = (p.seo ?? {}) as { title?: string; description?: string };
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    path: p.path,
    type: p.type,
    status: p.status,
    parentId: p.parentId,
    seoTitle: seo.title,
    seoDescription: seo.description,
    hasUnpublishedChanges: p.hasUnpublishedChanges,
    updatedAt: p.updatedAt,
  };
}

async function loadDraft(env: CapabilityEnv, id: string): Promise<{ page: PageDetail; blocks: BlockList }> {
  const page = await getPage(env.rt, env.session.ctx, { id, draft: true });
  return { page, blocks: structuredClone(page.blocks) as BlockList };
}

/** Saves a changed block list as the page's new draft (validated like the page builder does) and records what changed. */
async function saveDraft(env: CapabilityEnv, page: PageDetail, blocks: BlockList, action: string, detail: Record<string, unknown>) {
  try {
    const saved = await savePageDraft(env.rt, env.session.ctx, { id: page.id, blocks });
    await writeAgentAudit(env.rt, env.session, { action, targetType: "page", targetId: page.id, after: { ...detail, versionId: saved.versionId } });
    return { pageId: page.id, savedAsDraft: true, draftVersionId: saved.versionId, note: "Saved as a draft. The live page does not change until publish_page." };
  } catch (err) {
    if (err instanceof BlockEditError) throw new CapabilityError("invalid_input", err.message.replace(/^Bad Request: /, ""));
    throw err;
  }
}

function edit<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof BlockEditError) throw new CapabilityError("invalid_input", err.message.replace(/^Bad Request: /, ""));
    throw err;
  }
}

// ---------------------------------------------------------------- reads

export const listPagesCap = defineCapability({
  name: "list_pages",
  title: "List website pages",
  description: "The store's website pages (About, Contact, policies and so on) with their web address, status and parent. System pages such as the header, footer and home page are included and marked by type.",
  resource: "pages",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ search: z.string().max(100).optional().describe("Part of the title or address."), status: z.enum(["draft", "published"]).optional() }),
  async handler({ rt, session }, input) {
    const rows = await listPages(rt, session.ctx);
    const term = input.search?.trim().toLowerCase();
    const items = rows
      .filter((p) => (!input.status || p.status === input.status) && (!term || p.title.toLowerCase().includes(term) || p.slug.toLowerCase().includes(term)))
      .slice(0, 100)
      .map((p) => ({ id: p.id, title: p.title, path: p.path, slug: p.slug, type: p.type, status: p.status, parentId: p.parentId, childCount: p.childCount }));
    return { total: items.length, items };
  },
});

export const getPageCap = defineCapability({
  name: "get_page",
  title: "Get a page and its sections",
  description:
    "A page's settings and its sections as an outline (block id, type, a text hint, nested children). It shows the latest DRAFT, which is what the next publish would make live. Read one block's full settings with get_page_block.",
  resource: "pages",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ id: Id }),
  async handler(env, input) {
    const { page, blocks } = await loadDraft(env, input.id);
    return { ...shapePage(page), blocks: outlineBlocks(blocks) };
  },
});

export const getPageBlockCap = defineCapability({
  name: "get_page_block",
  title: "Get one section's settings",
  description: "The full settings (props) of one block in the page's draft: text, links, images, styles. Nested blocks inside it are shown as an outline.",
  resource: "pages",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ pageId: Id, blockId: BlockId }),
  async handler(env, input) {
    const { blocks } = await loadDraft(env, input.pageId);
    const hit = findBlock(blocks, input.blockId);
    if (!hit) throw new CapabilityError("not_found", "That block was not found on this page.");
    return shallowBlock(hit.block);
  },
});

export const listBlockTypesCap = defineCapability({
  name: "list_block_types",
  title: "List section types",
  description: "The kinds of sections a store page can contain (Heading, Text, Image, Button, Section and so on). container: true means it can hold other blocks. Use describe_block_type for the settings of one type.",
  resource: "pages",
  action: "read",
  kind: "read",
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({}),
  async handler() {
    return storeBlockTypes();
  },
});

export const describeBlockTypeCap = defineCapability({
  name: "describe_block_type",
  title: "Describe a section type",
  description: "The settings one section type accepts (names, allowed values, limits) and its defaults. Use it before add_page_block or set_page_block_props with a type you have not used yet.",
  resource: "pages",
  action: "read",
  kind: "read",
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ type: z.string().min(1).max(60) }),
  async handler(_env, input) {
    return describeBlockType(input.type);
  },
});

// ---------------------------------------------------------------- page settings

const PageSeo = {
  seoTitle: z.string().max(70).optional(),
  seoDescription: z.string().max(170).optional(),
};

export const createPageCap = defineCapability({
  name: "create_page",
  title: "Create a page (draft)",
  description: "Creates an empty website page that shoppers cannot see yet. Add sections with add_page_block, then publish_page.",
  resource: "pages",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({ title: z.string().min(1).max(120), slug: PageSlug.describe("The web address, for example about-us."), parentId: Id.nullable().optional().describe("Nest it under another page."), ...PageSeo }),
  async handler(env: CapabilityEnv, input) {
    const seo = input.seoTitle !== undefined || input.seoDescription !== undefined ? { ...(input.seoTitle !== undefined ? { title: input.seoTitle } : {}), ...(input.seoDescription !== undefined ? { description: input.seoDescription } : {}) } : undefined;
    const created = await createPage(env.rt, env.session.ctx, { title: input.title, slug: input.slug, ...(input.parentId !== undefined ? { parentId: input.parentId } : {}), ...(seo ? { seo } : {}) });
    const id = (created as { id: string }).id;
    const after = shapePage(await getPage(env.rt, env.session.ctx, { id, draft: true }));
    await writeAgentAudit(env.rt, env.session, { action: "page.created", targetType: "page", targetId: id, after });
    return after;
  },
});

export const updatePageCap = defineCapability({
  name: "update_page",
  title: "Edit a page's settings",
  description: "Changes the title, web address, parent page or search title and description. It does not change the sections (use the block tools). Changing the web address of a live page changes its link.",
  resource: "pages",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id, title: z.string().min(1).max(120).optional(), slug: PageSlug.optional(), parentId: Id.nullable().optional(), ...PageSeo }),
  async handler(env: CapabilityEnv, input) {
    const before = await getPage(env.rt, env.session.ctx, { id: input.id, draft: true });
    const current = (before.seo ?? {}) as { title?: string; description?: string; imageMediaId?: string | null };
    const seoChanged = input.seoTitle !== undefined || input.seoDescription !== undefined;
    await updatePage(env.rt, env.session.ctx, {
      id: input.id,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(seoChanged ? { seo: { ...current, ...(input.seoTitle !== undefined ? { title: input.seoTitle } : {}), ...(input.seoDescription !== undefined ? { description: input.seoDescription } : {}) } } : {}),
    });
    const after = shapePage(await getPage(env.rt, env.session.ctx, { id: input.id, draft: true }));
    await writeAgentAudit(env.rt, env.session, { action: "page.updated", targetType: "page", targetId: input.id, before: shapePage(before), after });
    return after;
  },
});

// ---------------------------------------------------------------- page content (blocks, saved as a draft)

export const setPageBlockPropsCap = defineCapability({
  name: "set_page_block_props",
  title: "Change a section's text, links or settings",
  description:
    "Changes settings of one block in the page's draft: only the props you pass are changed (null removes a prop). Text, headings, button labels and links are props. Links must start with /, #, https://, mailto: or tel:. The live page does not change until publish_page. Use describe_block_type for the allowed props.",
  resource: "pages",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ pageId: Id, blockId: BlockId, props: z.record(z.string(), z.unknown()).describe("For example { text: \"Our story\" } for a Heading, or { label: \"Shop now\", href: \"/collections/new\" } for a Button.") }),
  async handler(env: CapabilityEnv, input) {
    const { page, blocks } = await loadDraft(env, input.pageId);
    const next = edit(() => patchBlockProps(blocks, input.blockId, input.props));
    return saveDraft(env, page, next, "page.block.updated", { blockId: input.blockId, changed: Object.keys(input.props) });
  },
});

export const addPageBlockCap = defineCapability({
  name: "add_page_block",
  title: "Add a section to a page",
  description:
    "Adds a new block of the given type to the page's draft, with the type's default settings plus the props you pass. Put it inside a Section, Container or Block with parentBlockId, or at the top level. position is 0-based (omit for the end). Returns the new block id. The live page does not change until publish_page.",
  resource: "pages",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({
    pageId: Id,
    type: z.string().min(1).max(60).describe("A type from list_block_types."),
    props: z.record(z.string(), z.unknown()).optional(),
    parentBlockId: BlockId.optional().describe("A container block to put it into. Omit for the top level of the page."),
    position: z.number().int().min(0).max(500).optional(),
  }),
  async handler(env: CapabilityEnv, input) {
    const { page, blocks } = await loadDraft(env, input.pageId);
    const block = edit(() => newBlock(input.type, input.props ?? {}));
    const next = edit(() => insertBlock(blocks, block, input.parentBlockId, input.position));
    const saved = await saveDraft(env, page, next, "page.block.added", { blockId: block.id, type: input.type, parentBlockId: input.parentBlockId ?? null });
    return { ...saved, blockId: block.id };
  },
});

export const movePageBlockCap = defineCapability({
  name: "move_page_block",
  title: "Move a section",
  description: "Moves a block (with everything inside it) to another place in the page's draft: a new position at the top level, or inside a container block.",
  resource: "pages",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ pageId: Id, blockId: BlockId, parentBlockId: BlockId.optional().describe("The container to move it into. Omit for the top level."), position: z.number().int().min(0).max(500).optional() }),
  async handler(env: CapabilityEnv, input) {
    const { page, blocks } = await loadDraft(env, input.pageId);
    const next = edit(() => moveBlock(blocks, input.blockId, input.parentBlockId, input.position));
    return saveDraft(env, page, next, "page.block.moved", { blockId: input.blockId, parentBlockId: input.parentBlockId ?? null, position: input.position ?? null });
  },
});

export const removePageBlockCap = defineCapability({
  name: "remove_page_block",
  title: "Remove a section from a page draft",
  description:
    "Removes a block (and everything inside it) from the page's draft. The live page is not changed until publish_page, and every earlier version stays in the page's history, so this can be undone in the website builder. Requires confirm: true.",
  resource: "pages",
  action: "delete",
  kind: "write",
  annotations: { readOnly: false, destructive: true, idempotent: false },
  input: z.object({ pageId: Id, blockId: BlockId, confirm: Confirm }),
  async handler(env: CapabilityEnv, input) {
    const { page, blocks } = await loadDraft(env, input.pageId);
    const { blocks: next, removed } = edit(() => removeBlock(blocks, input.blockId));
    return saveDraft(env, page, next, "page.block.removed", { blockId: input.blockId, type: removed.type });
  },
});

export const setPageBlockHiddenCap = defineCapability({
  name: "set_page_block_hidden",
  title: "Hide or show a section",
  description: "Hides a block so shoppers do not see it, or shows it again, in the page's draft. Nothing is deleted.",
  resource: "pages",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ pageId: Id, blockId: BlockId, hidden: z.boolean() }),
  async handler(env: CapabilityEnv, input) {
    const { page, blocks } = await loadDraft(env, input.pageId);
    const next = edit(() => setBlockHidden(blocks, input.blockId, input.hidden));
    return saveDraft(env, page, next, "page.block.hidden", { blockId: input.blockId, hidden: input.hidden });
  },
});

// ---------------------------------------------------------------- publish, unpublish, delete

export const publishPageCap = defineCapability({
  name: "publish_page",
  title: "Publish a page",
  description: "Makes the page's latest draft the live page that shoppers see. Needs the store's Allow publishing switch, and the person who connected the app must be allowed to publish the website.",
  resource: "pages",
  action: "write",
  kind: "write",
  publishes: true,
  alsoNeeds: { permission: "theme.publish", text: "publish website pages" },
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id }),
  async handler(env: CapabilityEnv, input) {
    requirePublishing(env.session.settings.allowPublishing, "the page");
    const before = await getPage(env.rt, env.session.ctx, { id: input.id, draft: true });
    const r = await publishPage(env.rt, env.session.ctx, { id: input.id });
    await writeAgentAudit(env.rt, env.session, { action: "page.published", targetType: "page", targetId: input.id, before: { status: before.status }, after: { status: "published", versionId: r.publishedVersionId } });
    return { id: input.id, title: before.title, status: "published", path: before.path };
  },
});

export const unpublishPageCap = defineCapability({
  name: "unpublish_page",
  title: "Unpublish a page",
  description: "Takes the page off the website. Its sections and history are kept.",
  resource: "pages",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id }),
  async handler(env: CapabilityEnv, input) {
    const before = await getPage(env.rt, env.session.ctx, { id: input.id, draft: true });
    await unpublishPage(env.rt, env.session.ctx, { id: input.id });
    await writeAgentAudit(env.rt, env.session, { action: "page.unpublished", targetType: "page", targetId: input.id, before: { status: before.status }, after: { status: "draft" } });
    return { id: input.id, title: before.title, status: "draft" };
  },
});

export const deletePageCap = defineCapability({
  name: "delete_page",
  title: "Delete a page",
  description:
    "Permanently deletes a page and all its saved versions. Only a page that is not published can be deleted: unpublish it first. The store refuses to delete the home page, system pages, pages that have child pages, and pages linked from a menu. Requires confirm: true. Deleting cannot be undone.",
  resource: "pages",
  action: "delete",
  kind: "write",
  annotations: { readOnly: false, destructive: true, idempotent: false },
  input: z.object({ id: Id, confirm: Confirm }),
  async handler(env: CapabilityEnv, input) {
    const before = await getPage(env.rt, env.session.ctx, { id: input.id, draft: true });
    if (before.status === "published") throw new CapabilityError("invalid_input", "This page is live. Unpublish it first (unpublish_page), then delete it.");
    await deletePage(env.rt, env.session.ctx, { id: input.id });
    await writeAgentAudit(env.rt, env.session, { action: "page.deleted", targetType: "page", targetId: input.id, before: { title: before.title, slug: before.slug } });
    return { deleted: true, id: input.id, title: before.title };
  },
});

export const pageCapabilities = [
  listPagesCap,
  getPageCap,
  getPageBlockCap,
  listBlockTypesCap,
  describeBlockTypeCap,
  createPageCap,
  updatePageCap,
  setPageBlockPropsCap,
  addPageBlockCap,
  movePageBlockCap,
  removePageBlockCap,
  setPageBlockHiddenCap,
  publishPageCap,
  unpublishPageCap,
  deletePageCap,
];
