/** The product's long description as plain text. The admin stores it as `{ type: "text", text }` (older rows may hold a plain string). */
export function descriptionText(json: unknown): string {
  if (typeof json === "string") return json.trim();
  if (json && typeof json === "object" && "text" in json && typeof (json as { text: unknown }).text === "string") return (json as { text: string }).text.trim();
  return "";
}

/** Plain text split into paragraphs on blank lines (single line breaks stay inside a paragraph). */
export function paragraphs(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
