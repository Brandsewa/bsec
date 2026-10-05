/**
 * Cache tags always start with the tenant (PLAN §11.6): t:{tenantId}:product:{id}.
 * The bs/tenant-cache-tag lint rule accepts tenantTag() calls or `t:${id}:...` templates only.
 */
export type TagKind =
  | "product"
  | "collection"
  | "category"
  | "page"
  | "theme"
  | "nav"
  | "store-shell"
  | "seo"
  | "storage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function tenantTag(ctx: { tenantId: string } | string, kind: TagKind, id?: string): string {
  const tenantId = typeof ctx === "string" ? ctx : ctx.tenantId;
  if (!UUID.test(tenantId)) throw new Error(`tenantTag: invalid tenant id "${tenantId}"`);
  return id === undefined ? `t:${tenantId}:${kind}` : `t:${tenantId}:${kind}:${id}`;
}
