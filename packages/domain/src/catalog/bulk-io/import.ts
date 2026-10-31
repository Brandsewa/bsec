import { and, desc, eq, inArray } from "drizzle-orm";
import { QUEUE_NAMES, schema, withTenant } from "@bs/db";
import type { Runtime } from "../../runtime.ts";
import { assertPermission, type TenantContext } from "../../context.ts";
import { createProduct, getProduct, updateProduct, updateVariant } from "../../catalog-services.ts";
import { createVariant, deleteVariant } from "../variant-builder.ts";
import { customFieldsEnabled, setResourceCustomFields } from "../custom-fields.ts";
import { toRichTextHtml } from "./description.ts";
import { type ImportProduct, type ImportVariant } from "./parse.ts";

/**
 * Product import (docs/PRODUCT-BULK-IO-PLAN.md sections 4 and 7). The browser parses and maps the CSV, then sends products
 * in batches. Each product goes through the existing catalog services (quota, audit, cache and market-price rules apply)
 * and is committed on its own, so one bad product never blocks the rest. Problems are recorded on a `product_import_runs`
 * row that the progress screen polls.
 */

export type ConflictPolicy = "skip" | "update" | "replace";
export type ImportMode = "create_only" | "update_only" | "create_and_update";
export const IMPORT_MAX_PRODUCTS = 10_000;
export const IMPORT_BATCH_MAX = 50;
const MAX_STORED_ERRORS = 1000;

export interface ImportRunError {
  row: number;
  handle: string;
  kind: "row" | "conflict" | "image";
  message: string;
}

export interface ImageTask {
  productId: string;
  handle: string;
  urls: string[];
  alt?: string | undefined;
  /** sku -> image url, so the worker can link a variant to its image after downloading. */
  variantImages: Record<string, string>;
}

export type PreviewState = "new" | "exists" | "sku_conflict" | "unknown_category" | "missing_price";

export interface ProductImportPreview {
  total: number;
  toCreate: number;
  existing: number;
  skuConflicts: number;
  unknownCategories: number;
  images: number;
  issues: ImportRunError[];
  /** First 200 products with their state, for the preview table. */
  items: Array<{ row: number; handle: string; title: string; state: PreviewState; detail?: string | undefined }>;
}

interface CategoryIndex {
  byKey: Map<string, string>;
}

const norm = (s: string) => s.trim().toLowerCase();

async function loadCategoryIndex(rt: Runtime, ctx: TenantContext): Promise<CategoryIndex> {
  const rows = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
    tx.select({ id: schema.categories.id, name: schema.categories.name, slug: schema.categories.slug }).from(schema.categories).where(eq(schema.categories.tenantId, ctx.tenantId)),
  );
  const byKey = new Map<string, string>();
  for (const c of rows) {
    byKey.set(norm(c.name), c.id);
    byKey.set(norm(String(c.slug)), c.id);
  }
  return { byKey };
}

function assertImportSize(n: number, max: number) {
  if (n > max) throw new Error(`Bad Request: at most ${max.toLocaleString("en-IN")} products per request`);
}

/** Dry run: classifies every product, writes nothing. */
export async function previewProductImport(rt: Runtime, ctx: TenantContext, input: { products: ImportProduct[] }): Promise<ProductImportPreview> {
  assertPermission(ctx, "products.write");
  assertImportSize(input.products.length, IMPORT_MAX_PRODUCTS);
  const cats = await loadCategoryIndex(rt, ctx);
  const handles = input.products.map((p) => p.handle);
  const skus = input.products.flatMap((p) => p.variants.map((v) => v.sku).filter((s): s is string => Boolean(s)));

  const { existingProducts, skuOwners } = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const existingProducts = new Map<string, string>();
    for (let i = 0; i < handles.length; i += 1000) {
      const rows = await tx.select({ id: schema.products.id, slug: schema.products.slug }).from(schema.products).where(and(eq(schema.products.tenantId, ctx.tenantId), inArray(schema.products.slug, handles.slice(i, i + 1000))));
      for (const r of rows) existingProducts.set(norm(String(r.slug)), r.id);
    }
    const skuOwners = new Map<string, string>();
    for (let i = 0; i < skus.length; i += 1000) {
      const rows = await tx.select({ sku: schema.variants.sku, productId: schema.variants.productId }).from(schema.variants).where(and(eq(schema.variants.tenantId, ctx.tenantId), inArray(schema.variants.sku, skus.slice(i, i + 1000))));
      for (const r of rows) skuOwners.set(r.sku.toLowerCase(), r.productId);
    }
    return { existingProducts, skuOwners };
  });

  const out: ProductImportPreview = { total: input.products.length, toCreate: 0, existing: 0, skuConflicts: 0, unknownCategories: 0, images: 0, issues: [], items: [] };
  for (const p of input.products) {
    const existingId = existingProducts.get(norm(p.handle));
    let state: PreviewState = existingId ? "exists" : "new";
    let detail: string | undefined;
    if (p.primaryCategory && !cats.byKey.has(norm(p.primaryCategory))) {
      state = "unknown_category";
      detail = `Collection "${p.primaryCategory}" does not exist`;
      out.unknownCategories++;
    } else if (p.variants.some((v) => v.sku && skuOwners.has(v.sku.toLowerCase()) && skuOwners.get(v.sku.toLowerCase()) !== existingId)) {
      state = "sku_conflict";
      detail = "A SKU in this product belongs to a different product";
      out.skuConflicts++;
    } else if (!existingId && !p.variants.some((v) => v.price !== undefined)) {
      state = "missing_price";
      detail = "A new product needs a variant price";
    } else if (existingId) out.existing++;
    else out.toCreate++;
    if (state === "unknown_category" || state === "sku_conflict" || state === "missing_price") {
      out.issues.push({ row: p.row, handle: p.handle, kind: state === "sku_conflict" ? "conflict" : "row", message: detail ?? state });
    }
    if (state === "new" || state === "exists") out.images += p.imageUrls.length;
    if (out.items.length < 200) out.items.push({ row: p.row, handle: p.handle, title: p.title ?? "", state, detail });
  }
  return out;
}

export interface ProductImportRunView {
  id: string;
  status: string;
  conflictPolicy: ConflictPolicy;
  mode: ImportMode;
  fileName: string | null;
  productsTotal: number;
  productsDone: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  imagesTotal: number;
  imagesDone: number;
  imagesFailed: number;
  errors: ImportRunError[];
  errorsTruncated: number;
  createdAt: string;
  finishedAt: string | null;
}

type RunRow = typeof schema.productImportRuns.$inferSelect;
const toRunView = (r: RunRow): ProductImportRunView => ({
  id: r.id,
  status: r.status,
  conflictPolicy: r.conflictPolicy as ConflictPolicy,
  mode: r.mode as ImportMode,
  fileName: r.fileName,
  productsTotal: r.productsTotal,
  productsDone: r.productsDone,
  created: r.created,
  updated: r.updated,
  skipped: r.skipped,
  failed: r.failed,
  imagesTotal: r.imagesTotal,
  imagesDone: r.imagesDone,
  imagesFailed: r.imagesFailed,
  errors: (r.errors as ImportRunError[]) ?? [],
  errorsTruncated: r.errorsTruncated,
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
});

export async function startProductImportRun(
  rt: Runtime,
  ctx: TenantContext,
  input: { total: number; conflictPolicy: ConflictPolicy; mode: ImportMode; fileName?: string | undefined },
): Promise<ProductImportRunView> {
  assertPermission(ctx, "products.write");
  assertImportSize(input.total, IMPORT_MAX_PRODUCTS);
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(schema.productImportRuns)
      .values({
        tenantId: ctx.tenantId,
        status: "running",
        conflictPolicy: input.conflictPolicy,
        mode: input.mode,
        fileName: input.fileName?.slice(0, 200) ?? null,
        productsTotal: input.total,
        requestedBy: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      })
      .returning();
    if (!row) throw new Error("Failed to start the import");
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "product.import_started",
      targetType: "product_import_run",
      targetId: row.id,
      diff: { total: input.total, conflictPolicy: input.conflictPolicy, mode: input.mode },
    });
    return toRunView(row);
  });
}

export async function getProductImportRun(rt: Runtime, ctx: TenantContext, input: { id: string }): Promise<ProductImportRunView> {
  assertPermission(ctx, "products.read");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(schema.productImportRuns).where(and(eq(schema.productImportRuns.tenantId, ctx.tenantId), eq(schema.productImportRuns.id, input.id))).limit(1);
    if (!row) throw new Error("Not Found: import not found");
    return toRunView(row);
  });
}

export async function listProductImportRuns(rt: Runtime, ctx: TenantContext): Promise<ProductImportRunView[]> {
  assertPermission(ctx, "products.read");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const rows = await tx.select().from(schema.productImportRuns).where(eq(schema.productImportRuns.tenantId, ctx.tenantId)).orderBy(desc(schema.productImportRuns.createdAt)).limit(25);
    return rows.map(toRunView);
  });
}

type Outcome = { kind: "created" | "updated" | "skipped" | "failed"; productId?: string; message?: string; conflict?: boolean; warnings?: string[] };

const errMsg = (e: unknown) => (e instanceof Error ? e.message.replace(/^(Bad Request|Conflict|Not Found|Forbidden): /, "") : "import failed");

function seoFor(p: ImportProduct, current: unknown): Record<string, unknown> | undefined {
  if (p.seoTitle === undefined && p.seoDescription === undefined) return undefined;
  const seo = { ...((current ?? {}) as Record<string, unknown>) };
  if (p.seoTitle !== undefined) seo.title = p.seoTitle;
  if (p.seoDescription !== undefined) seo.description = p.seoDescription;
  return seo;
}

const variantTitle = (v: ImportVariant, i: number) => v.title ?? (v.optionValues.length ? v.optionValues.join(" / ") : i === 0 ? "Default" : `Variant ${i + 1}`);
const variantSku = (p: ImportProduct, v: ImportVariant, i: number) => v.sku ?? `${p.handle.toUpperCase()}-${i + 1}`;

function optionValuesOf(p: ImportProduct, v: ImportVariant): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  p.optionNames.forEach((name, i) => {
    const value = v.optionValues[i];
    if (name && value) out[name] = value;
  });
  return Object.keys(out).length ? out : undefined;
}

/** Typed custom-field values from raw cell text. Image fields are not importable from text; they are reported. */
async function applyCustomFields(rt: Runtime, ctx: TenantContext, productId: string, raw: Record<string, string>): Promise<string[]> {
  const keys = Object.keys(raw);
  if (!keys.length) return [];
  if (!(await customFieldsEnabled(rt._db.db, ctx.tenantId))) return ["Custom fields need the Growth plan, so those columns were ignored"];
  const defs = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
    tx.select().from(schema.customFieldDefinitions).where(and(eq(schema.customFieldDefinitions.tenantId, ctx.tenantId), eq(schema.customFieldDefinitions.resourceType, "product"))),
  );
  const byKey = new Map(defs.filter((d) => d.archivedAt === null).map((d) => [d.key, d]));
  const values: Record<string, unknown> = {};
  const warnings: string[] = [];
  for (const key of keys) {
    const def = byKey.get(key);
    const text = raw[key] ?? "";
    if (!def) {
      warnings.push(`Custom field "${key}" does not exist and was ignored`);
      continue;
    }
    if (text === "") {
      values[def.id] = null;
      continue;
    }
    switch (def.type) {
      case "number":
        values[def.id] = Number(text);
        break;
      case "boolean":
        values[def.id] = ["yes", "y", "true", "1"].includes(text.toLowerCase());
        break;
      case "multi_select":
        values[def.id] = text.split("|").map((s) => s.trim()).filter(Boolean);
        break;
      case "rich_text":
        values[def.id] = toRichTextHtml(text);
        break;
      case "image":
        warnings.push(`Custom field "${key}" is an image field and cannot be imported from a CSV`);
        break;
      default:
        values[def.id] = text;
    }
  }
  if (Object.keys(values).length) {
    try {
      await setResourceCustomFields(rt, ctx, { resourceType: "product", resourceId: productId, values });
    } catch (e) {
      warnings.push(`Custom fields not saved: ${errMsg(e)}`);
    }
  }
  return warnings;
}

async function createOne(rt: Runtime, ctx: TenantContext, p: ImportProduct, categoryId: string | undefined): Promise<Outcome> {
  if (!p.title) return { kind: "failed", message: "A new product needs a title" };
  if (!p.variants.length || p.variants.some((v) => v.price === undefined)) return { kind: "failed", message: "A new product needs a price on every variant" };
  const optionNames = p.optionNames.filter(Boolean);
  const options = optionNames.map((name, i) => ({ name, values: [...new Set(p.variants.map((v) => v.optionValues[i]).filter((x): x is string => Boolean(x)))] })).filter((o) => o.values.length);
  const seo = seoFor(p, null);
  const created = await createProduct(rt, ctx, {
    title: p.title,
    slug: p.handle,
    ...(p.status ? { status: p.status } : {}),
    ...(p.description ? { descriptionJson: { type: "text", text: p.description } } : {}),
    ...(p.shortDescription ? { shortDescription: p.shortDescription } : {}),
    ...(p.productType ? { productType: p.productType } : {}),
    ...(p.hsn ? { hsn: p.hsn } : {}),
    tags: p.tags ?? [],
    ...(p.isFeatured !== undefined ? { isFeatured: p.isFeatured } : {}),
    ...(p.returnable !== undefined ? { returnable: p.returnable } : {}),
    ...(p.requiresShipping !== undefined ? { requiresShipping: p.requiresShipping } : {}),
    ...(seo ? { seo } : {}),
    ...(categoryId ? { primaryCategoryId: categoryId } : {}),
    ...(options.length ? { options } : {}),
    variants: p.variants.map((v, i) => ({
      sku: variantSku(p, v, i),
      title: variantTitle(v, i),
      price: v.price ?? 0,
      ...(v.compareAtPrice ? { compareAtPrice: v.compareAtPrice } : {}),
      ...(v.costPrice ? { costPrice: v.costPrice } : {}),
      ...(v.trackInventory !== undefined ? { trackInventory: v.trackInventory } : {}),
      ...(v.allowBackorder !== undefined ? { allowBackorder: v.allowBackorder } : {}),
      ...(optionValuesOf(p, v) ? { optionValues: optionValuesOf(p, v)! } : {}),
    })),
  });
  // Barcode and weight are not part of the create input; set them on the new variants by SKU.
  for (const [i, v] of p.variants.entries()) {
    if (v.barcode === undefined && v.weightGrams === undefined) continue;
    const row = created.variants.find((x) => x.sku === variantSku(p, v, i));
    if (row) await updateVariant(rt, ctx, { id: row.id, ...(v.barcode !== undefined ? { barcode: v.barcode } : {}), ...(v.weightGrams !== undefined ? { weightGrams: v.weightGrams } : {}) });
  }
  const warnings = await applyCustomFields(rt, ctx, created.id, p.customFields);
  return { kind: "created", productId: created.id, warnings };
}

async function updateOne(rt: Runtime, ctx: TenantContext, p: ImportProduct, existingId: string, categoryId: string | undefined, replace: boolean): Promise<Outcome> {
  const current = await getProduct(rt, ctx, { id: existingId });
  const has = (k: string) => replace && p.fields.includes(k);
  const seo = seoFor(p, current.seo);
  await updateProduct(rt, ctx, {
    id: existingId,
    ...(p.title ? { title: p.title } : {}),
    ...(p.status ? { status: p.status } : {}),
    ...(p.description !== undefined || has("description") ? { descriptionJson: p.description ? { type: "text", text: p.description } : null } : {}),
    ...(p.shortDescription !== undefined || has("shortDescription") ? { shortDescription: p.shortDescription ?? "" } : {}),
    ...(p.productType !== undefined || has("productType") ? { productType: p.productType ?? "" } : {}),
    ...(p.hsn !== undefined || has("hsn") ? { hsn: p.hsn ?? null } : {}),
    ...(p.tags !== undefined || has("tags") ? { tags: p.tags ?? [] } : {}),
    ...(p.isFeatured !== undefined ? { isFeatured: p.isFeatured } : {}),
    ...(p.returnable !== undefined ? { returnable: p.returnable } : {}),
    ...(p.requiresShipping !== undefined ? { requiresShipping: p.requiresShipping } : {}),
    ...(seo ? { seo } : {}),
    ...(categoryId ? { primaryCategoryId: categoryId, extraCategoryIds: current.extraCategoryIds } : {}),
  });

  const warnings: string[] = [];
  const bySku = new Map(current.variants.map((v) => [v.sku.toLowerCase(), v]));
  const seen = new Set<string>();
  for (const [i, v] of p.variants.entries()) {
    // A file row without a SKU updates the product's only variant, otherwise it is a new variant with a generated SKU.
    const target = v.sku ? bySku.get(v.sku.toLowerCase()) : current.variants.length === 1 && p.variants.length === 1 ? current.variants[0] : undefined;
    if (target) {
      seen.add(target.sku.toLowerCase());
      await updateVariant(rt, ctx, {
        id: target.id,
        ...(v.title !== undefined ? { title: v.title } : {}),
        ...(v.price !== undefined ? { price: v.price } : {}),
        ...(v.compareAtPrice !== undefined ? { compareAtPrice: v.compareAtPrice } : {}),
        ...(v.costPrice !== undefined ? { costPrice: v.costPrice } : {}),
        ...(v.barcode !== undefined ? { barcode: v.barcode } : {}),
        ...(v.weightGrams !== undefined ? { weightGrams: v.weightGrams } : {}),
        ...(v.trackInventory !== undefined ? { trackInventory: v.trackInventory } : {}),
        ...(v.allowBackorder !== undefined ? { allowBackorder: v.allowBackorder } : {}),
        ...(optionValuesOf(p, v) ? { optionValues: optionValuesOf(p, v)! } : {}),
      });
    } else if (v.price === undefined) {
      warnings.push(`Variant ${v.sku ?? i + 1} is new and has no price, so it was not added`);
    } else {
      const sku = variantSku(p, v, current.variants.length + i);
      seen.add(sku.toLowerCase());
      await createVariant(rt, ctx, { productId: existingId, sku, title: variantTitle(v, i), price: v.price, ...(v.compareAtPrice ? { compareAtPrice: v.compareAtPrice } : {}), ...(v.costPrice ? { costPrice: v.costPrice } : {}), ...(v.barcode ? { barcode: v.barcode } : {}), ...(v.weightGrams !== undefined ? { weightGrams: v.weightGrams } : {}), ...(optionValuesOf(p, v) ? { optionValues: optionValuesOf(p, v)! } : {}) });
    }
  }
  if (replace && p.variants.length) {
    for (const v of current.variants) {
      if (seen.has(v.sku.toLowerCase())) continue;
      try {
        await deleteVariant(rt, ctx, { id: v.id });
      } catch (e) {
        warnings.push(`Variant ${v.sku} was kept: ${errMsg(e)}`);
      }
    }
  }
  warnings.push(...(await applyCustomFields(rt, ctx, existingId, p.customFields)));
  return { kind: "updated", productId: existingId, warnings };
}

/**
 * Saves one batch of products into a run and updates its counters. Returns the image downloads to run for the
 * products that were saved (the caller hands them to the image job). Safe to call batch after batch.
 */
export async function commitProductImportBatch(
  rt: Runtime,
  ctx: TenantContext,
  input: { runId: string; products: ImportProduct[] },
): Promise<{ run: ProductImportRunView; imageTasks: ImageTask[] }> {
  assertPermission(ctx, "products.write");
  assertImportSize(input.products.length, IMPORT_BATCH_MAX);
  const run = await getProductImportRun(rt, ctx, { id: input.runId });
  if (run.status !== "running") throw new Error("Conflict: this import has already finished");
  const cats = await loadCategoryIndex(rt, ctx);
  const preview = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const handles = input.products.map((p) => p.handle);
    const skus = input.products.flatMap((p) => p.variants.map((v) => v.sku).filter((s): s is string => Boolean(s)));
    const prods = handles.length ? await tx.select({ id: schema.products.id, slug: schema.products.slug }).from(schema.products).where(and(eq(schema.products.tenantId, ctx.tenantId), inArray(schema.products.slug, handles))) : [];
    const vars = skus.length ? await tx.select({ sku: schema.variants.sku, productId: schema.variants.productId }).from(schema.variants).where(and(eq(schema.variants.tenantId, ctx.tenantId), inArray(schema.variants.sku, skus))) : [];
    return { existing: new Map(prods.map((r) => [norm(String(r.slug)), r.id])), skuOwner: new Map(vars.map((r) => [r.sku.toLowerCase(), r.productId])) };
  });

  const counters = { created: 0, updated: 0, skipped: 0, failed: 0, images: 0 };
  const errors: ImportRunError[] = [];
  const imageTasks: ImageTask[] = [];

  for (const p of input.products) {
    const fail = (kind: ImportRunError["kind"], message: string) => errors.push({ row: p.row, handle: p.handle, kind, message });
    let outcome: Outcome;
    try {
      const existingId = preview.existing.get(norm(p.handle));
      let categoryId: string | undefined;
      if (p.primaryCategory) {
        categoryId = cats.byKey.get(norm(p.primaryCategory));
        if (!categoryId) throw new Error(`Collection "${p.primaryCategory}" does not exist, so the product was not imported`);
      }
      const clash = p.variants.find((v) => v.sku && preview.skuOwner.has(v.sku.toLowerCase()) && preview.skuOwner.get(v.sku.toLowerCase()) !== existingId);
      if (clash) {
        outcome = { kind: "skipped", conflict: true, message: `SKU ${clash.sku} already belongs to a different product` };
      } else if (existingId) {
        if (run.mode === "create_only" || run.conflictPolicy === "skip") outcome = { kind: "skipped", conflict: true, message: "A product with this URL handle already exists" };
        else outcome = await updateOne(rt, ctx, p, existingId, categoryId, run.conflictPolicy === "replace");
      } else if (run.mode === "update_only") {
        outcome = { kind: "skipped", message: "No product with this URL handle exists (update only)" };
      } else {
        outcome = await createOne(rt, ctx, p, categoryId);
      }
    } catch (e) {
      outcome = { kind: "failed", message: errMsg(e) };
    }

    counters[outcome.kind]++;
    if (outcome.message) fail(outcome.conflict ? "conflict" : "row", outcome.message);
    for (const w of outcome.warnings ?? []) fail("row", w);
    if ((outcome.kind === "created" || outcome.kind === "updated") && outcome.productId && p.imageUrls.length) {
      counters.images += p.imageUrls.length;
      imageTasks.push({
        productId: outcome.productId,
        handle: p.handle,
        urls: p.imageUrls,
        ...(p.imageAlt ? { alt: p.imageAlt } : {}),
        variantImages: Object.fromEntries(p.variants.filter((v) => v.imageUrl).map((v, i) => [variantSku(p, v, i), v.imageUrl!])),
      });
    }
    if (outcome.productId) {
      await withTenant(rt._db.db, ctx.tenantId, (tx) =>
        tx.insert(schema.auditLogs).values({
          tenantId: ctx.tenantId,
          actorType: ctx.actor.type,
          actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
          action: outcome.kind === "created" ? "product.created" : "product.updated",
          targetType: "product",
          targetId: outcome.productId!,
          diff: { source: "import", runId: input.runId, policy: run.conflictPolicy },
        }),
      );
    }
  }

  let updated = await recordBatch(rt, ctx, input.runId, counters, errors, input.products.length);
  // Side effects after commit, through pg-boss (ADR-006). Without a queue the images are reported as failed, never silently dropped.
  for (const task of imageTasks) {
    try {
      if (!rt._jobs) throw new Error("background jobs are not available");
      await rt._jobs.send(QUEUE_NAMES.PRODUCTS_IMPORT_IMAGES, { tenantId: ctx.tenantId, runId: input.runId, actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null, task });
    } catch (e) {
      for (const url of task.urls) {
        await recordImportImageResult(rt, ctx.tenantId, input.runId, { ok: false, error: { row: 0, handle: task.handle, kind: "image", message: `${url.slice(0, 120)}: not downloaded (${errMsg(e)})` } });
      }
    }
  }
  if (imageTasks.length) updated = await getProductImportRun(rt, ctx, { id: input.runId });
  return { run: updated, imageTasks };
}

async function recordBatch(
  rt: Runtime,
  ctx: TenantContext,
  runId: string,
  c: { created: number; updated: number; skipped: number; failed: number; images: number },
  errors: ImportRunError[],
  batchSize: number,
): Promise<ProductImportRunView> {
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(schema.productImportRuns).where(and(eq(schema.productImportRuns.tenantId, ctx.tenantId), eq(schema.productImportRuns.id, runId))).for("update");
    if (!row) throw new Error("Not Found: import not found");
    const stored = (row.errors as ImportRunError[]) ?? [];
    const room = Math.max(0, MAX_STORED_ERRORS - stored.length);
    const productsDone = row.productsDone + batchSize;
    const imagesTotal = row.imagesTotal + c.images;
    const finished = productsDone >= row.productsTotal && row.imagesDone + row.imagesFailed >= imagesTotal;
    const failed = row.failed + c.failed;
    const hasProblems = failed > 0 || row.imagesFailed > 0;
    const [next] = await tx
      .update(schema.productImportRuns)
      .set({
        productsDone,
        created: row.created + c.created,
        updated: row.updated + c.updated,
        skipped: row.skipped + c.skipped,
        failed,
        imagesTotal,
        errors: [...stored, ...errors.slice(0, room)],
        errorsTruncated: row.errorsTruncated + Math.max(0, errors.length - room),
        updatedAt: new Date(),
        ...(finished ? { status: hasProblems ? "completed_with_errors" : "completed", finishedAt: new Date() } : {}),
      })
      .where(eq(schema.productImportRuns.id, runId))
      .returning();
    return toRunView(next ?? row);
  });
}

/** For the worker: one image finished (or failed). Closes the run when everything is done. */
export async function recordImportImageResult(rt: Runtime, tenantId: string, runId: string, result: { ok: boolean; error?: ImportRunError | undefined }): Promise<void> {
  await withTenant(rt._db.db, tenantId, async (tx) => {
    const [row] = await tx.select().from(schema.productImportRuns).where(and(eq(schema.productImportRuns.tenantId, tenantId), eq(schema.productImportRuns.id, runId))).for("update");
    if (!row) return;
    const stored = (row.errors as ImportRunError[]) ?? [];
    const imagesDone = row.imagesDone + (result.ok ? 1 : 0);
    const imagesFailed = row.imagesFailed + (result.ok ? 0 : 1);
    const finished = row.productsDone >= row.productsTotal && imagesDone + imagesFailed >= row.imagesTotal;
    const addError = result.error && stored.length < MAX_STORED_ERRORS;
    await tx
      .update(schema.productImportRuns)
      .set({
        imagesDone,
        imagesFailed,
        ...(addError ? { errors: [...stored, result.error!] } : {}),
        ...(result.error && !addError ? { errorsTruncated: row.errorsTruncated + 1 } : {}),
        updatedAt: new Date(),
        ...(finished ? { status: row.failed > 0 || imagesFailed > 0 ? "completed_with_errors" : "completed", finishedAt: new Date() } : {}),
      })
      .where(eq(schema.productImportRuns.id, runId));
  });
}

