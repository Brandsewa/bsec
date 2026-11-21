/**
 * Whether a rendered block list already produces an H1: a Heading block set to level h1, or a slider whose first slide uses h1
 * (the only two block settings that emit one, packages/blocks registry). Pages without one get a visually hidden H1 with the
 * store or page name so every page has exactly one (docs/SEO-GEO-AEO-PLAN.md Phase 2, finding 14). Uses the serialised props so a
 * nested block is found without knowing every container's shape.
 */
export function blocksHaveH1(blocks: unknown): boolean {
  try {
    const json = JSON.stringify(blocks) ?? "";
    return /"level":"h1"/.test(json) || /"titleTag":"h1"/.test(json);
  } catch {
    return false;
  }
}
