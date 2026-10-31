import { toMinorUnits } from "@bs/contracts/money";
import { CUSTOM_FIELD_PREFIX } from "./columns.ts";
import { importDescriptionToText } from "./description.ts";

/** Typing this in a cell empties the field on update; a blank cell leaves it alone. */
export const CLEAR_TOKEN = "[clear]";
export const IMPORT_STATUSES = ["draft", "active", "unlisted", "archived"] as const;

export interface ImportVariant {
  row: number;
  sku?: string | undefined;
  title?: string | undefined;
  optionValues: string[];
  price?: number | undefined;
  compareAtPrice?: number | null | undefined;
  costPrice?: number | null | undefined;
  barcode?: string | undefined;
  weightGrams?: number | undefined;
  trackInventory?: boolean | undefined;
  allowBackorder?: boolean | undefined;
  imageUrl?: string | undefined;
}

export interface ImportProduct {
  /** First CSV row of the product (1 = header, so data starts at 2). */
  row: number;
  handle: string;
  title?: string | undefined;
  shortDescription?: string | undefined;
  description?: string | undefined;
  status?: (typeof IMPORT_STATUSES)[number] | undefined;
  primaryCategory?: string | undefined;
  tags?: string[] | undefined;
  productType?: string | undefined;
  hsn?: string | undefined;
  seoTitle?: string | undefined;
  seoDescription?: string | undefined;
  isFeatured?: boolean | undefined;
  returnable?: boolean | undefined;
  requiresShipping?: boolean | undefined;
  optionNames: string[];
  variants: ImportVariant[];
  imageUrls: string[];
  imageAlt?: string | undefined;
  /** Custom field key -> raw cell text; typed and validated against the definition at commit. */
  customFields: Record<string, string>;
  /** Mapped field keys, so an update only touches columns the file actually carries. */
  fields: string[];
}

export interface ParseIssue {
  row: number;
  handle: string;
  error: string;
}

const TRUE = new Set(["yes", "y", "true", "1"]);
const FALSE = new Set(["no", "n", "false", "0"]);

const parseBool = (v: string): boolean | undefined => {
  const s = v.trim().toLowerCase();
  return TRUE.has(s) ? true : FALSE.has(s) ? false : undefined;
};

/** "₹1,299.50" -> 129950. Returns null for anything that is not a clean non-negative amount. */
export function parsePriceCell(raw: string, currency: string): number | null {
  const cleaned = raw.trim().replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return toMinorUnits(Number(cleaned), currency);
}

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const splitList = (v: string): string[] => [...new Set(v.split(/[|,]/).map((t) => t.trim()).filter(Boolean))];

const isHttpsUrl = (v: string): boolean => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Groups mapped CSV rows into products. `rows` excludes the header; `mapping[i]` is the field key for column i (or null).
 * A row with a handle starts or continues that product; a row with no handle continues the one above (variant and image rows).
 * Problems are reported per row and the offending product is dropped, so one bad product never blocks the others.
 */
export function parseProductRows(
  rows: string[][],
  mapping: Array<string | null>,
  currency: string,
): { products: ImportProduct[]; issues: ParseIssue[] } {
  const products: ImportProduct[] = [];
  const issues: ParseIssue[] = [];
  const byHandle = new Map<string, ImportProduct>();
  const bad = new Set<string>();
  const fields = [...new Set(mapping.filter((m): m is string => Boolean(m)))];
  let current: ImportProduct | null = null;

  rows.forEach((cells, index) => {
    const rowNo = index + 2;
    const get = (key: string): string => {
      const i = mapping.indexOf(key);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };
    if (cells.every((c) => !c.trim())) return;

    const title = get("title");
    let handle = slugify(get("handle"));
    if (!handle && title) handle = slugify(title);
    if (!handle && !current) {
      issues.push({ row: rowNo, handle: "", error: "URL handle or title is required on the first row of a product" });
      return;
    }

    let product = handle ? byHandle.get(handle) : current;
    if (!product) {
      product = { row: rowNo, handle, optionNames: [], variants: [], imageUrls: [], customFields: {}, fields };
      byHandle.set(handle, product);
      products.push(product);
    }
    current = product;
    const fail = (error: string) => {
      issues.push({ row: rowNo, handle: product!.handle, error });
      bad.add(product!.handle);
    };

    // Product-level fields: the first non-blank value wins.
    const text = (key: string, apply: (p: ImportProduct, v: string) => void) => {
      const v = get(key);
      if (v) apply(product!, v === CLEAR_TOKEN ? "" : v);
    };
    text("title", (p, v) => (p.title ??= v));
    text("shortDescription", (p, v) => (p.shortDescription ??= v));
    text("description", (p, v) => (p.description ??= importDescriptionToText(v)));
    text("primaryCategory", (p, v) => (p.primaryCategory ??= v));
    text("productType", (p, v) => (p.productType ??= v));
    text("hsn", (p, v) => (p.hsn ??= v));
    text("seoTitle", (p, v) => (p.seoTitle ??= v));
    text("seoDescription", (p, v) => (p.seoDescription ??= v));
    text("imageAlt", (p, v) => (p.imageAlt ??= v));
    text("tags", (p, v) => (p.tags ??= v ? splitList(v) : []));

    const status = get("status").toLowerCase();
    if (status && !product.status) {
      const mapped = status === "true" ? "active" : status === "false" ? "draft" : status;
      if ((IMPORT_STATUSES as readonly string[]).includes(mapped)) product.status = mapped as ImportProduct["status"];
      else fail(`status "${get("status")}" is not one of draft, active, unlisted, archived`);
    }
    for (const flag of ["isFeatured", "returnable", "requiresShipping"] as const) {
      const raw = get(flag);
      if (!raw) continue;
      const b = parseBool(raw);
      if (b === undefined) fail(`${flag} must be yes or no`);
      else product[flag] ??= b;
    }

    for (const key of mapping) {
      if (key?.startsWith(CUSTOM_FIELD_PREFIX)) {
        const v = get(key);
        if (v) product.customFields[key.slice(CUSTOM_FIELD_PREFIX.length)] ??= v === CLEAR_TOKEN ? "" : v;
      }
    }

    // Images: featured first, then additional, https only, in file order.
    const urls = [get("imageUrl"), ...get("additionalImages").split("|")].map((u) => u.trim()).filter(Boolean);
    for (const u of urls) {
      if (!isHttpsUrl(u)) fail(`image URL must start with https:// (${u.slice(0, 60)})`);
      else if (!product.imageUrls.includes(u)) product.imageUrls.push(u);
    }

    // Variant: a row that carries any variant column. A product with none gets a default variant at commit.
    const optionValues: string[] = [];
    for (const n of [1, 2, 3]) {
      const name = get(`option${n}Name`);
      const value = get(`option${n}Value`);
      if (name && !product.optionNames[n - 1]) product.optionNames[n - 1] = name;
      if (value) optionValues[n - 1] = value;
    }
    const variant: ImportVariant = { row: rowNo, optionValues: optionValues.filter((v) => v !== undefined) };
    const sku = get("sku");
    if (sku) variant.sku = sku;
    const vt = get("variantTitle");
    if (vt) variant.title = vt;
    const bc = get("barcode");
    if (bc) variant.barcode = bc;
    for (const key of ["price", "compareAtPrice", "costPrice"] as const) {
      const raw = get(key);
      if (!raw) continue;
      if (raw === CLEAR_TOKEN && key !== "price") {
        variant[key] = null;
        continue;
      }
      const minor = parsePriceCell(raw, currency);
      if (minor === null) fail(`${key} "${raw}" is not a valid amount`);
      else variant[key] = minor;
    }
    const grams = get("weightGrams");
    if (grams) {
      if (/^\d+$/.test(grams)) variant.weightGrams = Number(grams);
      else fail(`weight "${grams}" must be a whole number of grams`);
    }
    for (const flag of ["trackInventory", "allowBackorder"] as const) {
      const raw = get(flag);
      if (raw) {
        const b = parseBool(raw);
        if (b === undefined) fail(`${flag} must be yes or no`);
        else variant[flag] = b;
      }
    }
    const vImg = get("variantImageUrl");
    if (vImg) {
      if (isHttpsUrl(vImg)) {
        variant.imageUrl = vImg;
        if (!product.imageUrls.includes(vImg)) product.imageUrls.push(vImg);
      } else fail("variant image URL must start with https://");
    }
    const hasVariantData = sku || vt || optionValues.length > 0 || get("price") || get("compareAtPrice") || get("costPrice") || bc || grams || vImg;
    if (hasVariantData) product.variants.push(variant);
  });

  for (const p of products) {
    if (!p.variants.length) continue;
    const seen = new Set<string>();
    for (const v of p.variants) {
      if (!v.sku) continue;
      if (seen.has(v.sku.toLowerCase())) {
        issues.push({ row: v.row, handle: p.handle, error: `SKU ${v.sku} appears twice in this product` });
        bad.add(p.handle);
      }
      seen.add(v.sku.toLowerCase());
    }
  }

  return { products: products.filter((p) => !bad.has(p.handle)), issues };
}
