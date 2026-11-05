import { toast } from "@bs/ui";

/** Most records one bulk-editing session loads (docs/BULK-EDITOR-PLAN.md). */
export const BULK_EDIT_LIMIT = 250;

/** Hands the chosen ids to the editor page through sessionStorage (250 ids are too long for the address bar). */
export function openBulkEditor(kind: "products" | "categories" | "collections", ids: string[], go: () => void) {
  if (ids.length === 0) return;
  const capped = ids.slice(0, BULK_EDIT_LIMIT);
  try {
    sessionStorage.setItem(`bulk-edit:${kind}`, JSON.stringify(capped));
  } catch {
    toast.error("Your browser blocked the editor. Allow site storage and try again.");
    return;
  }
  if (ids.length > BULK_EDIT_LIMIT) toast.info(`Editing the first ${BULK_EDIT_LIMIT} of ${ids.length}. Narrow the list to edit the rest.`);
  go();
}
