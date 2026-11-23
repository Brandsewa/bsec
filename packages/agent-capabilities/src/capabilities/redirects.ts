import { z } from "zod";
import { createRedirect, deleteRedirect, listRedirects, updateRedirect, writeAgentAudit } from "@bs/domain";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE, decodeCursor, encodeCursor } from "../shape.ts";
import { defineCapability, type CapabilityEnv } from "../types.ts";
import { Confirm, Id, InternalPath } from "./content-shared.ts";

const Status = z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).describe("301 or 308 = permanent (the default is 308), 302 or 307 = temporary.");

const From = InternalPath.describe("The old address on this store, for example /old-page.");
const To = InternalPath.describe("Where visitors go instead, a path on this store, for example /products/new-name. Addresses on other sites are not allowed over AI access.");

export const listRedirectsCap = defineCapability({
  name: "list_redirects",
  title: "List redirects",
  description: "The store's redirects (old address to new address), newest first.",
  resource: "redirects",
  action: "read",
  kind: "read",
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({
    search: z.string().max(100).optional().describe("Part of the old or the new address."),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().describe(`How many to return (default ${DEFAULT_PAGE_SIZE}).`),
    cursor: z.string().max(200).optional(),
  }),
  async handler({ rt, session }, input) {
    const pageSize = Math.min(MAX_PAGE_SIZE, input.limit ?? DEFAULT_PAGE_SIZE);
    const offset = decodeCursor(input.cursor);
    // The service pages by whole pages; fetch from the start of the page that holds the offset and slice.
    const page = Math.floor(offset / pageSize) + 1;
    const r = await listRedirects(rt, session.ctx, { page, pageSize, ...(input.search ? { search: input.search } : {}) });
    const start = (page - 1) * pageSize;
    const items = r.items.slice(Math.max(0, offset - start)).map((x) => ({ id: x.id, from: x.fromPath, to: x.toPath, status: x.statusCode, source: x.source }));
    const next = offset + items.length;
    return { items, total: r.total, maxRedirects: r.limit, ...(next < r.total && items.length > 0 ? { nextCursor: encodeCursor(next) } : {}) };
  },
});

export const createRedirectCap = defineCapability({
  name: "create_redirect",
  title: "Add a redirect",
  description: "Sends visitors from an old address to a new one on this store. The store refuses loops, reserved addresses (such as /cart or /admin) and an address that already redirects.",
  resource: "redirects",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: false },
  input: z.object({ from: From, to: To, status: Status.optional() }),
  async handler(env: CapabilityEnv, input) {
    const created = await createRedirect(env.rt, env.session.ctx, { from: input.from, to: input.to, ...(input.status ? { status: input.status } : {}) });
    await writeAgentAudit(env.rt, env.session, { action: "redirect.created", targetType: "redirect", targetId: created.id, after: { from: created.fromPath, to: created.toPath, status: created.statusCode } });
    return { id: created.id, from: created.fromPath, to: created.toPath, status: created.statusCode };
  },
});

export const updateRedirectCap = defineCapability({
  name: "update_redirect",
  title: "Edit a redirect",
  description: "Changes only the fields you pass.",
  resource: "redirects",
  action: "write",
  kind: "write",
  annotations: { readOnly: false, destructive: false, idempotent: true },
  input: z.object({ id: Id, from: From.optional(), to: To.optional(), status: Status.optional() }),
  async handler(env: CapabilityEnv, input) {
    const updated = await updateRedirect(env.rt, env.session.ctx, input.id, {
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
      ...(input.status ? { status: input.status } : {}),
    });
    await writeAgentAudit(env.rt, env.session, { action: "redirect.updated", targetType: "redirect", targetId: input.id, after: { from: updated.fromPath, to: updated.toPath, status: updated.statusCode } });
    return { id: updated.id, from: updated.fromPath, to: updated.toPath, status: updated.statusCode };
  },
});

export const deleteRedirectCap = defineCapability({
  name: "delete_redirect",
  title: "Delete a redirect",
  description: "Removes a redirect, so the old address stops forwarding. Requires confirm: true.",
  resource: "redirects",
  action: "delete",
  kind: "write",
  annotations: { readOnly: false, destructive: true, idempotent: false },
  input: z.object({ id: Id, confirm: Confirm }),
  async handler(env: CapabilityEnv, input) {
    await deleteRedirect(env.rt, env.session.ctx, input.id);
    await writeAgentAudit(env.rt, env.session, { action: "redirect.deleted", targetType: "redirect", targetId: input.id });
    return { deleted: true, id: input.id };
  },
});

export const redirectCapabilities = [listRedirectsCap, createRedirectCap, updateRedirectCap, deleteRedirectCap];
