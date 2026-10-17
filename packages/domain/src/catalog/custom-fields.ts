import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { sanitizeBlogHtml } from "@bs/blocks";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { syncMediaUsages } from "../media-services.ts";
import { publicMediaUrl } from "../media/storage.ts";
import {
  CUSTOM_FIELD_RESOURCES,
  CUSTOM_FIELD_TYPES,
  MAX_FIELDS_PER_RESOURCE,
  hasFieldValue,
  normalizeFieldKey,
  normalizeFieldOptions,
  normalizeFieldValue,
  type CustomFieldResource,
  type CustomFieldType,
  type FieldOption,
  type ValueContext,
} from "./custom-field-rules.ts";

/** Sanitiser and text extractor for rich text values: the same strict pipeline as the blog, with no embedded images. */
const valueContext: ValueContext = {
  sanitizeHtml: (html) => sanitizeBlogHtml(html, new Map()),
  htmlToText: (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " "),
};

type DefinitionRow = typeof schema.customFieldDefinitions.$inferSelect;

export interface CustomFieldDefinitionView {
  id: string;
  resourceType: CustomFieldResource;
  key: string;
  name: string;
  type: CustomFieldType;
  helpText: string | null;
  required: boolean;
  showOnStorefront: boolean;
  options: FieldOption[];
  position: number;
  archived: boolean;
}

function toView(row: DefinitionRow): CustomFieldDefinitionView {
  const config = (row.config ?? {}) as { options?: FieldOption[] };
  return {
    id: row.id,
    resourceType: row.resourceType as CustomFieldResource,
    key: row.key,
    name: row.name,
    type: row.type as CustomFieldType,
    helpText: row.helpText,
    required: row.required,
    showOnStorefront: row.showOnStorefront,
    options: config.options ?? [],
    position: row.position,
    archived: row.archivedAt !== null,
  };
}

/** True when the store's plan includes custom fields (Growth and above, owner decision 2026-10-17). */
export async function customFieldsEnabled(db: Db, tenantId: string): Promise<boolean> {
  const res = await db.execute<{ features: Record<string, unknown> | string | null }>(sql`
    SELECT p.features
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
     WHERE s.tenant_id = ${tenantId}
       AND s.status IN ('active', 'trialing', 'past_due')
     ORDER BY s.created_at DESC
     LIMIT 1
  `);
  const raw = res.rows[0]?.features;
  const features = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw ?? {});
  return features["custom_fields"] === true;
}

async function assertEnabled(db: Db, tenantId: string): Promise<void> {
  if (!(await customFieldsEnabled(db, tenantId))) {
    throw new Error("Forbidden: custom fields are available on the Growth plan and above. Upgrade your plan to use them");
  }
}

function checkResource(value: string): CustomFieldResource {
  if (!(CUSTOM_FIELD_RESOURCES as readonly string[]).includes(value)) throw new Error("Bad Request: unknown resource type");
  return value as CustomFieldResource;
}

async function audit(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  ctx: TenantContext,
  action: string,
  targetType: string,
  targetId: string,
  diff: Record<string, unknown>,
) {
  await tx.insert(schema.auditLogs).values({
    tenantId: ctx.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
    action,
    targetType,
    targetId,
    diff,
  });
}

/** The store's custom field definitions for a resource, in the owner's order. `enabled` tells the UI whether the plan includes them. */
export async function listCustomFieldDefinitions(
  rt: Runtime,
  ctx: TenantContext,
  input: { resourceType: CustomFieldResource; includeArchived?: boolean | undefined },
): Promise<{ enabled: boolean; definitions: CustomFieldDefinitionView[] }> {
  assertPermission(ctx, "products.read");
  const resourceType = checkResource(input.resourceType);
  const db = rt._db.db;
  const enabled = await customFieldsEnabled(db, ctx.tenantId);
  const rows = await withTenant(db, ctx.tenantId, (tx) =>
    tx
      .select()
      .from(schema.customFieldDefinitions)
      .where(
        and(
          eq(schema.customFieldDefinitions.tenantId, ctx.tenantId),
          eq(schema.customFieldDefinitions.resourceType, resourceType),
          input.includeArchived ? undefined : isNull(schema.customFieldDefinitions.archivedAt),
        ),
      )
      .orderBy(asc(schema.customFieldDefinitions.position), asc(schema.customFieldDefinitions.createdAt)),
  );
  return { enabled, definitions: rows.map(toView) };
}

export interface CreateCustomFieldInput {
  resourceType: CustomFieldResource;
  name: string;
  key?: string | undefined;
  type: CustomFieldType;
  helpText?: string | null | undefined;
  required?: boolean | undefined;
  showOnStorefront?: boolean | undefined;
  options?: Array<{ value?: string | undefined; label: string }> | undefined;
}

export async function createCustomFieldDefinition(rt: Runtime, ctx: TenantContext, input: CreateCustomFieldInput): Promise<CustomFieldDefinitionView> {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;
  await assertEnabled(db, ctx.tenantId);
  const resourceType = checkResource(input.resourceType);
  if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(input.type)) throw new Error("Bad Request: unknown field type");
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) throw new Error("Bad Request: give the field a name of up to 80 characters");
  const key = normalizeFieldKey(input.key?.trim() || name);
  const needsOptions = input.type === "dropdown" || input.type === "multi_select";
  const options = needsOptions ? normalizeFieldOptions(input.options ?? []) : [];

  const row = await withTenant(db, ctx.tenantId, async (tx) => {
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int`, maxPos: sql<number>`coalesce(max(${schema.customFieldDefinitions.position}), -1)::int` })
      .from(schema.customFieldDefinitions)
      .where(and(eq(schema.customFieldDefinitions.tenantId, ctx.tenantId), eq(schema.customFieldDefinitions.resourceType, resourceType), isNull(schema.customFieldDefinitions.archivedAt)));
    if (Number(count?.n ?? 0) >= MAX_FIELDS_PER_RESOURCE) throw new Error(`Bad Request: you can have at most ${MAX_FIELDS_PER_RESOURCE} custom fields for ${resourceType}s`);

    const [dup] = await tx
      .select({ id: schema.customFieldDefinitions.id })
      .from(schema.customFieldDefinitions)
      .where(and(eq(schema.customFieldDefinitions.tenantId, ctx.tenantId), eq(schema.customFieldDefinitions.resourceType, resourceType), eq(schema.customFieldDefinitions.key, key)))
      .limit(1);
    if (dup) throw new Error(`Conflict: a field with the key "${key}" already exists. Choose a different name or key`);

    const [created] = await tx
      .insert(schema.customFieldDefinitions)
      .values({
        tenantId: ctx.tenantId,
        resourceType,
        key,
        name,
        type: input.type,
        helpText: input.helpText?.trim() || null,
        required: input.required ?? false,
        showOnStorefront: input.showOnStorefront ?? true,
        config: needsOptions ? { options } : {},
        position: Number(count?.maxPos ?? -1) + 1,
      })
      .returning();
    if (!created) throw new Error("Failed to create the custom field");
    await audit(tx, ctx, "custom_field.created", "custom_field", created.id, { resourceType, key, type: input.type, name });
    return created;
  });
  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return toView(row);
}

export interface UpdateCustomFieldInput {
  id: string;
  name?: string | undefined;
  helpText?: string | null | undefined;
  required?: boolean | undefined;
  showOnStorefront?: boolean | undefined;
  options?: Array<{ value?: string | undefined; label: string }> | undefined;
  position?: number | undefined;
}

/** Changes what the owner sees and how it is shown. The key and the type never change: stored values depend on them. */
export async function updateCustomFieldDefinition(rt: Runtime, ctx: TenantContext, input: UpdateCustomFieldInput): Promise<CustomFieldDefinitionView> {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;
  await assertEnabled(db, ctx.tenantId);

  const row = await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.customFieldDefinitions)
      .where(and(eq(schema.customFieldDefinitions.id, input.id), eq(schema.customFieldDefinitions.tenantId, ctx.tenantId)))
      .limit(1);
    if (!existing) throw new Error("Not Found: custom field not found");

    const patch: Partial<typeof schema.customFieldDefinitions.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = input.name.replace(/\s+/g, " ").trim();
      if (!name || name.length > 80) throw new Error("Bad Request: give the field a name of up to 80 characters");
      patch.name = name;
    }
    if (input.helpText !== undefined) patch.helpText = input.helpText?.trim() || null;
    if (input.required !== undefined) patch.required = input.required;
    if (input.showOnStorefront !== undefined) patch.showOnStorefront = input.showOnStorefront;
    if (input.position !== undefined) patch.position = input.position;
    if (input.options !== undefined) {
      if (existing.type !== "dropdown" && existing.type !== "multi_select") throw new Error("Bad Request: only dropdown and multi-select fields have options");
      patch.config = { options: normalizeFieldOptions(input.options) };
    }
    const [updated] = await tx
      .update(schema.customFieldDefinitions)
      .set(patch)
      .where(and(eq(schema.customFieldDefinitions.id, input.id), eq(schema.customFieldDefinitions.tenantId, ctx.tenantId)))
      .returning();
    if (!updated) throw new Error("Not Found: custom field not found");
    await audit(tx, ctx, "custom_field.updated", "custom_field", updated.id, { key: updated.key, changed: Object.keys(input).filter((k) => k !== "id") });
    return updated;
  });
  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return toView(row);
}

/** Archives a field (hides it from the product page and the storefront; values are kept) or brings it back. */
export async function setCustomFieldArchived(rt: Runtime, ctx: TenantContext, input: { id: string; archived: boolean }): Promise<CustomFieldDefinitionView> {
  assertPermission(ctx, "products.write");
  const db = rt._db.db;

  const row = await withTenant(db, ctx.tenantId, async (tx) => {
    const [updated] = await tx
      .update(schema.customFieldDefinitions)
      .set({ archivedAt: input.archived ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(schema.customFieldDefinitions.id, input.id), eq(schema.customFieldDefinitions.tenantId, ctx.tenantId)))
      .returning();
    if (!updated) throw new Error("Not Found: custom field not found");
    await audit(tx, ctx, input.archived ? "custom_field.archived" : "custom_field.restored", "custom_field", updated.id, { key: updated.key });
    return updated;
  });
  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return toView(row);
}

export interface ResourceCustomField {
  definition: CustomFieldDefinitionView;
  /** The stored value, typed by the definition (image values are { mediaId } plus a resolved `url`). */
  value: unknown | null;
  imageUrl?: string | undefined;
}

async function ownerCondition(resourceType: CustomFieldResource, resourceId: string) {
  return resourceType === "product" ? eq(schema.customFieldValues.productId, resourceId) : eq(schema.customFieldValues.collectionId, resourceId);
}

/** Every active field for a product or collection with its current value, for the edit page. */
export async function getResourceCustomFields(
  rt: Runtime,
  ctx: TenantContext,
  input: { resourceType: CustomFieldResource; resourceId: string },
): Promise<{ enabled: boolean; fields: ResourceCustomField[] }> {
  assertPermission(ctx, "products.read");
  const resourceType = checkResource(input.resourceType);
  const db = rt._db.db;
  const enabled = await customFieldsEnabled(db, ctx.tenantId);
  if (!enabled) return { enabled, fields: [] };

  const fields = await withTenant(db, ctx.tenantId, async (tx) => {
    const defs = await tx
      .select()
      .from(schema.customFieldDefinitions)
      .where(and(eq(schema.customFieldDefinitions.tenantId, ctx.tenantId), eq(schema.customFieldDefinitions.resourceType, resourceType), isNull(schema.customFieldDefinitions.archivedAt)))
      .orderBy(asc(schema.customFieldDefinitions.position), asc(schema.customFieldDefinitions.createdAt));
    if (defs.length === 0) return [];
    const values = await tx
      .select()
      .from(schema.customFieldValues)
      .where(and(eq(schema.customFieldValues.tenantId, ctx.tenantId), await ownerCondition(resourceType, input.resourceId)));
    const byDef = new Map(values.map((v) => [v.definitionId, v.value]));

    const imageIds = defs.filter((d) => d.type === "image").map((d) => (byDef.get(d.id) as { mediaId?: string } | undefined)?.mediaId).filter((v): v is string => Boolean(v));
    const media = imageIds.length
      ? await tx.select({ id: schema.media.id, key: schema.media.storageKey }).from(schema.media).where(and(eq(schema.media.tenantId, ctx.tenantId), inArray(schema.media.id, imageIds)))
      : [];
    const urlById = new Map(media.map((m) => [m.id, publicMediaUrl(m.key)]));

    return defs.map((d): ResourceCustomField => {
      const value = byDef.has(d.id) ? byDef.get(d.id) : null;
      const mediaId = d.type === "image" ? (value as { mediaId?: string } | null)?.mediaId : undefined;
      return { definition: toView(d), value: value ?? null, ...(mediaId ? { imageUrl: urlById.get(mediaId) } : {}) };
    });
  });
  return { enabled, fields };
}

/**
 * Saves the submitted values for a product or collection. Keys are definition ids; a value of null clears the field.
 * Every value is validated against its definition (typed, never raw HTML), required fields must be filled, and image
 * values must be files in this store's media library.
 */
export async function setResourceCustomFields(
  rt: Runtime,
  ctx: TenantContext,
  input: { resourceType: CustomFieldResource; resourceId: string; values: Record<string, unknown> },
): Promise<{ enabled: boolean; fields: ResourceCustomField[] }> {
  assertPermission(ctx, "products.write");
  const resourceType = checkResource(input.resourceType);
  const db = rt._db.db;
  await assertEnabled(db, ctx.tenantId);

  await withTenant(db, ctx.tenantId, async (tx) => {
    const defs = await tx
      .select()
      .from(schema.customFieldDefinitions)
      .where(and(eq(schema.customFieldDefinitions.tenantId, ctx.tenantId), eq(schema.customFieldDefinitions.resourceType, resourceType), isNull(schema.customFieldDefinitions.archivedAt)));
    const defById = new Map(defs.map((d) => [d.id, d]));
    for (const id of Object.keys(input.values)) {
      if (!defById.has(id)) throw new Error("Bad Request: one of the fields no longer exists. Reload the page and try again");
    }

    const owner = resourceType === "product"
      ? await tx.select({ id: schema.products.id }).from(schema.products).where(and(eq(schema.products.id, input.resourceId), eq(schema.products.tenantId, ctx.tenantId))).limit(1)
      : await tx.select({ id: schema.collections.id }).from(schema.collections).where(and(eq(schema.collections.id, input.resourceId), eq(schema.collections.tenantId, ctx.tenantId))).limit(1);
    if (owner.length === 0) throw new Error(`Not Found: ${resourceType} not found`);

    const existing = await tx
      .select()
      .from(schema.customFieldValues)
      .where(and(eq(schema.customFieldValues.tenantId, ctx.tenantId), await ownerCondition(resourceType, input.resourceId)));
    const current = new Map(existing.map((v) => [v.definitionId, v]));

    const changed: string[] = [];
    const normalizedById = new Map<string, unknown>();
    for (const [defId, raw] of Object.entries(input.values)) {
      const def = defById.get(defId);
      if (!def) continue; // unknown ids were rejected above
      const normalized = normalizeFieldValue({ name: def.name, type: def.type as CustomFieldType, required: def.required, config: def.config as { options?: FieldOption[] } }, raw, valueContext);

      if (normalized !== null && def.type === "image") {
        const mediaId = (normalized as { mediaId: string }).mediaId;
        const [m] = await tx
          .select({ id: schema.media.id, kind: schema.media.kind })
          .from(schema.media)
          .where(and(eq(schema.media.id, mediaId), eq(schema.media.tenantId, ctx.tenantId)))
          .limit(1);
        if (!m || (m.kind && m.kind !== "image")) throw new Error(`Bad Request: "${def.name}" needs an image from your media library`);
      }

      normalizedById.set(defId, normalized);
      const had = current.get(defId);
      if (normalized === null) {
        if (had) {
          await tx.delete(schema.customFieldValues).where(and(eq(schema.customFieldValues.id, had.id), eq(schema.customFieldValues.tenantId, ctx.tenantId)));
          changed.push(def.key);
        }
      } else if (had) {
        if (JSON.stringify(had.value) !== JSON.stringify(normalized)) {
          await tx.update(schema.customFieldValues).set({ value: normalized, updatedAt: new Date() }).where(and(eq(schema.customFieldValues.id, had.id), eq(schema.customFieldValues.tenantId, ctx.tenantId)));
          changed.push(def.key);
        }
      } else {
        await tx.insert(schema.customFieldValues).values({
          tenantId: ctx.tenantId,
          definitionId: defId,
          ...(resourceType === "product" ? { productId: input.resourceId } : { collectionId: input.resourceId }),
          value: normalized,
        });
        changed.push(def.key);
      }

      if (def.type === "image") {
        await syncMediaUsages(tx, ctx, {
          ownerType: resourceType,
          ownerId: input.resourceId,
          field: `custom.${def.key}`,
          mediaIds: normalized === null ? [] : [(normalized as { mediaId: string }).mediaId],
        });
      }
    }

    // Required fields: everything that is required must have a value after this save.
    const after = new Map<string, unknown>(existing.map((v) => [v.definitionId, v.value]));
    for (const [defId, normalized] of normalizedById) {
      if (normalized === null) after.delete(defId);
      else after.set(defId, normalized);
    }
    for (const def of defs) {
      if (def.required && !hasFieldValue(after.get(def.id))) throw new Error(`Bad Request: "${def.name}" is required`);
    }

    if (changed.length > 0) {
      await audit(tx, ctx, "custom_field.values_saved", resourceType, input.resourceId, { fields: changed });
    }
  });

  await invalidateCache(
    rt,
    ctx,
    resourceType === "product" ? { type: "product_updated", productId: input.resourceId } : { type: "collection_updated", collectionId: input.resourceId },
  );
  return getResourceCustomFields(rt, ctx, { resourceType, resourceId: input.resourceId });
}

export interface StorefrontCustomField {
  key: string;
  name: string;
  type: CustomFieldType;
  /** Display-ready: text, sanitised HTML (rich_text), option labels (dropdown, multi_select), number, boolean. */
  value: string | string[] | number | boolean;
  imageUrl?: string | undefined;
  imageAlt?: string | undefined;
}

/**
 * The values to show on a storefront product or collection page: only active fields the owner chose to show, with a
 * value, and only while the plan includes custom fields. Called with the storefront's system context (no permission
 * check: this is public data by design).
 */
export async function getStorefrontCustomFields(
  rt: Runtime,
  ctx: TenantContext,
  input: { resourceType: CustomFieldResource; resourceId: string },
): Promise<StorefrontCustomField[]> {
  const resourceType = checkResource(input.resourceType);
  const db = rt._db.db;
  if (!(await customFieldsEnabled(db, ctx.tenantId))) return [];

  return withTenant(db, ctx.tenantId, async (tx) => {
    const defs = await tx
      .select()
      .from(schema.customFieldDefinitions)
      .where(
        and(
          eq(schema.customFieldDefinitions.tenantId, ctx.tenantId),
          eq(schema.customFieldDefinitions.resourceType, resourceType),
          eq(schema.customFieldDefinitions.showOnStorefront, true),
          isNull(schema.customFieldDefinitions.archivedAt),
        ),
      )
      .orderBy(asc(schema.customFieldDefinitions.position), asc(schema.customFieldDefinitions.createdAt));
    if (defs.length === 0) return [];
    const values = await tx
      .select()
      .from(schema.customFieldValues)
      .where(and(eq(schema.customFieldValues.tenantId, ctx.tenantId), await ownerCondition(resourceType, input.resourceId)));
    const byDef = new Map(values.map((v) => [v.definitionId, v.value]));

    const imageIds = defs.filter((d) => d.type === "image").map((d) => (byDef.get(d.id) as { mediaId?: string } | undefined)?.mediaId).filter((v): v is string => Boolean(v));
    const media = imageIds.length
      ? await tx.select({ id: schema.media.id, key: schema.media.storageKey, alt: schema.media.alt }).from(schema.media).where(and(eq(schema.media.tenantId, ctx.tenantId), inArray(schema.media.id, imageIds)))
      : [];
    const mediaById = new Map(media.map((m) => [m.id, m]));

    const out: StorefrontCustomField[] = [];
    for (const d of defs) {
      const raw = byDef.get(d.id);
      if (!hasFieldValue(raw)) continue;
      const options = ((d.config ?? {}) as { options?: FieldOption[] }).options ?? [];
      const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
      const base = { key: d.key, name: d.name, type: d.type as CustomFieldType };
      switch (d.type) {
        case "image": {
          const m = mediaById.get((raw as { mediaId: string }).mediaId);
          const url = m ? publicMediaUrl(m.key) : undefined;
          if (url) out.push({ ...base, value: url, imageUrl: url, imageAlt: m?.alt ?? d.name });
          break;
        }
        case "dropdown":
          out.push({ ...base, value: labelOf(raw as string) });
          break;
        case "multi_select":
          out.push({ ...base, value: (raw as string[]).map(labelOf) });
          break;
        case "rich_text":
          // Cleaned on save and again here, so stored HTML is never trusted blindly.
          out.push({ ...base, value: sanitizeBlogHtml(String(raw), new Map()) });
          break;
        default:
          out.push({ ...base, value: raw as string | number | boolean });
      }
    }
    return out;
  });
}
