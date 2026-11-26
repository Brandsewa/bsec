/**
 * Text that was saved with HTML entities ("Wholesale &amp; Bulk Tea", usually from an import out of another platform) shows up in
 * the browser tab and in search results as the entity itself, because the page head escapes the text once more. A title or a
 * description is plain text, so it is decoded before it goes into the head.
 */
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };

function decodeOnce(s: string): string {
  return s.replace(/&(?:#(\d{1,6})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (name) return NAMED[name.toLowerCase()] ?? whole;
    const code = dec ? Number(dec) : Number.parseInt(hex ?? "", 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

/** Decodes entities, twice at most (text that was escaped twice reads `&amp;amp;`). Text with no `&` is returned as it is. */
export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  const once = decodeOnce(input);
  return once.includes("&") ? decodeOnce(once) : once;
}
