/**
 * Pure rules for custom fields (owner request 2026-10-17, ADR-034): what a field definition may look like and how a
 * submitted value is checked and normalised for its type. No database access, so these are tested on their own.
 * Values are typed data, never raw HTML or code (ADR-010): rich text goes through the injected sanitiser.
 */

export const CUSTOM_FIELD_TYPES = ["text", "rich_text", "image", "dropdown", "multi_select", "number", "boolean"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export const CUSTOM_FIELD_RESOURCES = ["product", "collection"] as const;
export type CustomFieldResource = (typeof CUSTOM_FIELD_RESOURCES)[number];

export const MAX_FIELDS_PER_RESOURCE = 50;
export const MAX_OPTIONS = 50;
export const MAX_TEXT_LENGTH = 500;
export const MAX_RICH_TEXT_LENGTH = 20_000;

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDefinitionLike {
  name: string;
  type: CustomFieldType;
  required: boolean;
  config: { options?: FieldOption[] | undefined } | null | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A field key: lowercase letters, numbers and underscores, starting with a letter, up to 40 characters. */
export function normalizeFieldKey(input: string): string {
  const key = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
    throw new Error("Bad Request: the field key must start with a letter and use only letters, numbers and underscores (up to 40 characters)");
  }
  return key;
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Cleans a dropdown's options: trims, gives each a stable value, rejects empty and duplicate options. */
export function normalizeFieldOptions(options: Array<{ value?: string | undefined; label: string }>): FieldOption[] {
  if (options.length === 0) throw new Error("Bad Request: add at least one option");
  if (options.length > MAX_OPTIONS) throw new Error(`Bad Request: a field can have at most ${MAX_OPTIONS} options`);
  const seen = new Set<string>();
  const out: FieldOption[] = [];
  for (const raw of options) {
    const label = raw.label.replace(/\s+/g, " ").trim();
    if (!label) throw new Error("Bad Request: an option needs a label");
    if (label.length > 60) throw new Error("Bad Request: option labels can be at most 60 characters");
    const value = (raw.value?.trim() || slug(label)).slice(0, 60);
    if (!value) throw new Error(`Bad Request: the option "${label}" needs letters or numbers`);
    if (seen.has(value)) throw new Error(`Bad Request: the option "${label}" is listed twice`);
    seen.add(value);
    out.push({ value, label });
  }
  return out;
}

const isEmptyString = (v: unknown) => typeof v === "string" && v.trim() === "";

export interface ValueContext {
  /** Cleans submitted rich text (removes scripts, event handlers, unsafe links). */
  sanitizeHtml: (html: string) => string;
  /** Plain text length of sanitised rich text, to detect "empty" content. */
  htmlToText: (html: string) => string;
}

/**
 * Checks one submitted value against its definition. Returns the normalised value to store, or null when the field is
 * empty (which removes any stored value). Throws a plain "Bad Request" message when the value is not acceptable.
 * Required fields are enforced by the caller, which knows whether a draft is being saved.
 */
export function normalizeFieldValue(def: FieldDefinitionLike, raw: unknown, ctx: ValueContext): unknown | null {
  if (raw === null || raw === undefined) return null;
  const label = def.name;
  switch (def.type) {
    case "text": {
      if (typeof raw !== "string") throw new Error(`Bad Request: "${label}" must be text`);
      if (isEmptyString(raw)) return null;
      const text = raw.replace(/\r\n/g, "\n").trim();
      if (text.length > MAX_TEXT_LENGTH) throw new Error(`Bad Request: "${label}" can be at most ${MAX_TEXT_LENGTH} characters`);
      return text;
    }
    case "rich_text": {
      if (typeof raw !== "string") throw new Error(`Bad Request: "${label}" must be text`);
      if (raw.length > MAX_RICH_TEXT_LENGTH * 2) throw new Error(`Bad Request: "${label}" is too long`);
      const clean = ctx.sanitizeHtml(raw).replace(/<p>\s*(<br\s*\/?>)?\s*<\/p>/g, "").trim();
      if (clean === "" || ctx.htmlToText(clean).trim() === "") return null;
      if (clean.length > MAX_RICH_TEXT_LENGTH) throw new Error(`Bad Request: "${label}" can be at most ${MAX_RICH_TEXT_LENGTH} characters`);
      return clean;
    }
    case "image": {
      const id = typeof raw === "string" ? raw : (raw as { mediaId?: unknown } | null)?.mediaId;
      if (id === "" || id === undefined || id === null) return null;
      if (typeof id !== "string" || !UUID.test(id)) throw new Error(`Bad Request: "${label}" needs an image from the media library`);
      return { mediaId: id.toLowerCase() };
    }
    case "dropdown": {
      if (typeof raw !== "string") throw new Error(`Bad Request: "${label}" must be one of the options`);
      if (isEmptyString(raw)) return null;
      const options = def.config?.options ?? [];
      if (!options.some((o) => o.value === raw)) throw new Error(`Bad Request: "${raw}" is not an option of "${label}"`);
      return raw;
    }
    case "multi_select": {
      if (!Array.isArray(raw)) throw new Error(`Bad Request: "${label}" must be a list of options`);
      const options = def.config?.options ?? [];
      const chosen: string[] = [];
      for (const v of raw) {
        if (typeof v !== "string" || !options.some((o) => o.value === v)) throw new Error(`Bad Request: "${String(v)}" is not an option of "${label}"`);
        if (!chosen.includes(v)) chosen.push(v);
      }
      // Keep the order the owner defined the options in, so display is stable.
      const ordered = options.map((o) => o.value).filter((v) => chosen.includes(v));
      return ordered.length === 0 ? null : ordered;
    }
    case "number": {
      if (typeof raw === "string" && raw.trim() === "") return null;
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
      if (!Number.isFinite(n)) throw new Error(`Bad Request: "${label}" must be a number`);
      if (Math.abs(n) > 1e12) throw new Error(`Bad Request: "${label}" is too large`);
      return n;
    }
    case "boolean": {
      if (typeof raw !== "boolean") throw new Error(`Bad Request: "${label}" must be yes or no`);
      return raw;
    }
    default:
      throw new Error(`Bad Request: unknown field type`);
  }
}

/** True when a stored value should count as "filled in" for display and for the required check. */
export function hasFieldValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}
