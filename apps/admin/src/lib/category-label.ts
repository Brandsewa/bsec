interface CategoryNode {
  id: string;
  name: string;
  parentId?: string | null | undefined;
}

/**
 * Display label for a category in pickers: its own name, or "Parent > Child" when nested.
 * (`categories.path` is a materialised path of parent ids, never shown to users.) The walk is capped so a
 * corrupt parent loop can never hang the page.
 */
export function categoryLabel(category: CategoryNode, all: readonly CategoryNode[]): string {
  const byId = new Map(all.map((c) => [c.id, c]));
  const names = [category.name];
  let parentId = category.parentId ?? null;
  for (let depth = 0; parentId && depth < 4; depth += 1) {
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId ?? null;
  }
  return names.join(" > ");
}
