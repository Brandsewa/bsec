import { hasPermission, isCellAllowed, storePermissionFor, type AgentSession, type AiAction, type AiResource, type StorePermission } from "@bs/domain";
import { CapabilityError } from "./errors.ts";
import type { AnyCapability } from "./types.ts";

/** True when the store matrix allows the cell AND the approving user still holds the matching store permission. */
export function canAccess(session: AgentSession, resource: AiResource, action: AiAction): boolean {
  if (!isCellAllowed(session.settings.matrix, resource, action)) return false;
  return hasPermission(session.ctx.permissions, storePermissionFor(resource, action) as StorePermission);
}

const VERB: Record<AiAction, string> = { read: "read", write: "change", delete: "delete or archive" };
const RESOURCE_TEXT: Partial<Record<AiResource, string>> = { blog: "blog posts", pages: "website pages and menus", redirects: "redirects", categories: "categories" };

/** Why a capability is not available, or null when it is. Plain language: the AI relays it to the merchant. */
export function refusalFor(session: AgentSession, cap: AnyCapability): string | null {
  if (cap.resource && cap.action) {
    if (!isCellAllowed(session.settings.matrix, cap.resource, cap.action)) {
      return `This store has not allowed AI apps to ${VERB[cap.action]} ${RESOURCE_TEXT[cap.resource] ?? cap.resource}. The store owner can change this in Settings > AI access > Permissions.`;
    }
    if (!hasPermission(session.ctx.permissions, storePermissionFor(cap.resource, cap.action) as StorePermission)) {
      return `The person who connected this app does not have permission to ${VERB[cap.action]} ${RESOURCE_TEXT[cap.resource] ?? cap.resource} in this store.`;
    }
  }
  if (cap.alsoNeeds && !hasPermission(session.ctx.permissions, cap.alsoNeeds.permission as StorePermission)) {
    return `The person who connected this app does not have permission to ${cap.alsoNeeds.text} in this store.`;
  }
  if (cap.publishes && !session.settings.allowPublishing) {
    return "This store has not allowed AI apps to publish. The store owner can turn on Allow publishing in Settings > AI access > Permissions.";
  }
  return null;
}

export function assertAllowed(session: AgentSession, cap: AnyCapability): void {
  const reason = refusalFor(session, cap);
  if (reason) throw new CapabilityError("forbidden", reason);
}

/** The capabilities this connection may call right now (used to filter the tool list). */
export function allowedCapabilities(session: AgentSession, all: readonly AnyCapability[]): AnyCapability[] {
  return all.filter((c) => refusalFor(session, c) === null);
}
