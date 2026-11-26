import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createMenu, deleteMenu, getMenu, listMenus, updateMenu, writeAgentAudit } from "@bs/domain";
import { CapabilityError } from "../errors.ts";
import { defineCapability, type CapabilityEnv } from "../types.ts";
import { Confirm, Id, SafeLink } from "./content-shared.ts";

/**
 * Navigation menus (header, footer and any other). A menu has no draft: saving it changes the live website at once, so editing
 * one needs the store's Allow publishing switch, like making any other content visible. Only plain navigation menus are offered;
 * the storefront's filter menus stay a human task.
 */

const MenuUrl = SafeLink.or(z.literal(""));
const ItemType = z.enum(["url", "page", "collection", "product", "category", "brand", "blog", "blog_category", "blog_post", "policy", "home", "search", "account"]);

const Leaf = z.object({
  id: z.string().max(80).optional().describe("Keep the id from get_menu when you edit an existing item."),
  title: z.string().min(1).max(80).describe("The text shoppers see."),
  url: MenuUrl.describe("Where it goes: a path on the store such as /pages/about, or an https:// link."),
  type: ItemType.optional().describe("Defaults to url. Keep the type and targetId of an item you did not change."),
  targetId: z.string().max(80).optional(),
  openInNewTab: z.boolean().optional().describe("Only https links can open in a new tab."),
});
const Mid = Leaf.extend({ children: z.array(Leaf).max(30).optional() });
const Top = Leaf.extend({ children: z.array(Mid).max(30).optional() });
const Items = z.array(Top).max(30).describe("The whole list of items, in order, up to 3 levels deep. It replaces the existing items.");

type Item = z.infer<typeof Top>;

/** Gives every item an id and a type, as the menu editor expects. */
function prepare(items: Item[]): unknown[] {
  const walk = (list: Array<z.infer<typeof Leaf> & { children?: unknown[] }>): unknown[] =>
    list.map((it) => ({ ...it, id: it.id ?? randomUUID(), type: it.type ?? "url", ...(it.children ? { children: walk(it.children as never) } : {}) }));
  return walk(items as never);
}

export const listMenusCap = defineCapability({
  name: "list_menus",
  title: "List menus",
  description: "The store's navigation menus (header, footer and others) with how many items each has and where they are used. Read one with get_menu.",
  resource: "pages",
  action: "read",
  kind: "read",
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({}),
  async handler({ rt, session }) {
    const rows = await listMenus(rt, session.ctx);
    return rows.filter((m) => m.kind === "navigation").map((m) => ({ id: m.id, name: m.name, handle: m.handle, itemCount: m.itemCount, usedIn: m.usedIn, isProtected: m.isProtected }));
  },
});

export const getMenuCap = defineCapability({
  name: "get_menu",
  title: "Get a menu",
  description: "One menu with all its items (title, link, nested children).",
  resource: "pages",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ handle: z.string().min(1).max(80).describe("The menu handle from list_menus, for example main-menu.") }),
  async handler({ rt, session }, input) {
    const m = await getMenu(rt, session.ctx, { handle: input.handle });
    return { id: m.id, name: m.name, handle: m.handle, kind: m.kind, isProtected: m.isProtected, usedIn: m.usedIn, items: m.items };
  },
});

export const createMenuCap = defineCapability({
  name: "create_menu",
  title: "Create a menu",
  description: "Creates a new navigation menu. It appears nowhere on the website until a page section or the theme uses its handle.",
  resource: "pages",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({ name: z.string().min(1).max(80), handle: z.string().min(1).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens."), items: Items.optional() }),
  async handler(env: CapabilityEnv, input) {
    const created = await createMenu(env.rt, env.session.ctx, { name: input.name, handle: input.handle, kind: "navigation", items: prepare(input.items ?? []) });
    await writeAgentAudit(env.rt, env.session, { action: "menu.created", targetType: "menu", targetId: created.id, after: { name: created.name, handle: created.handle, itemCount: created.itemCount } });
    return { id: created.id, name: created.name, handle: created.handle, itemCount: created.itemCount };
  },
});

export const updateMenuCap = defineCapability({
  name: "update_menu",
  title: "Edit a menu",
  description:
    "Changes a menu's name and/or replaces its items. This changes the live website straight away (a menu has no draft), so it needs the store's Allow publishing switch. Pass the complete item list: read it with get_menu, change it, and send it back.",
  resource: "pages",
  action: "write",
  kind: "write",
  publishes: true,
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id, name: z.string().min(1).max(80).optional(), items: Items.optional() }),
  async handler(env: CapabilityEnv, input) {
    const all = await listMenus(env.rt, env.session.ctx);
    const meta = all.find((m) => m.id === input.id);
    if (!meta) throw new CapabilityError("not_found", "That menu was not found.");
    const before = await getMenu(env.rt, env.session.ctx, { handle: meta.handle });
    const updated = await updateMenu(env.rt, env.session.ctx, { id: input.id, ...(input.name !== undefined ? { name: input.name } : {}), ...(input.items ? { items: prepare(input.items) } : {}) });
    await writeAgentAudit(env.rt, env.session, {
      action: "menu.updated",
      targetType: "menu",
      targetId: input.id,
      before: { name: before.name, itemCount: before.itemCount, items: before.items },
      after: { name: updated.name, itemCount: updated.itemCount },
    });
    return { id: updated.id, name: updated.name, handle: updated.handle, itemCount: updated.itemCount };
  },
});

export const deleteMenuCap = defineCapability({
  name: "delete_menu",
  title: "Delete a menu",
  description: "Permanently deletes a menu. The store's default menus (header, footer) and any menu that is in use cannot be deleted over AI access. Requires confirm: true. Deleting cannot be undone.",
  resource: "pages",
  action: "delete",
  kind: "write",
  annotations: { readOnly: false, destructive: true, idempotent: false },
  input: z.object({ id: Id, confirm: Confirm }),
  async handler(env: CapabilityEnv, input) {
    const all = await listMenus(env.rt, env.session.ctx);
    const meta = all.find((m) => m.id === input.id);
    if (!meta) throw new CapabilityError("not_found", "That menu was not found.");
    if (meta.isProtected) throw new CapabilityError("invalid_input", "This is one of the store's default menus. It can only be deleted by a person in the admin.");
    if (meta.usedIn.length > 0) throw new CapabilityError("invalid_input", `This menu is used by ${meta.usedIn.join(", ")}. Remove it from there first.`);
    await deleteMenu(env.rt, env.session.ctx, { id: input.id });
    await writeAgentAudit(env.rt, env.session, { action: "menu.deleted", targetType: "menu", targetId: input.id, before: { name: meta.name, handle: meta.handle } });
    return { deleted: true, id: input.id, name: meta.name };
  },
});

export const menuCapabilities = [listMenusCap, getMenuCap, createMenuCap, updateMenuCap, deleteMenuCap];
