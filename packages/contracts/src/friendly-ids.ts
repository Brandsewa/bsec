/**
 * Human-friendly ids (owner decision 2026-10-17). The database keeps uuids as the real keys; these are display
 * and reference labels only: products are BCPID-<n> (a running number per store), stores are BCSID-<nnnn> (a
 * running number across the platform).
 */
export function formatProductId(productNumber: number | null | undefined): string | null {
  return typeof productNumber === "number" && productNumber > 0 ? `BCPID-${productNumber}` : null;
}

export function formatStoreId(storeNumber: number | null | undefined): string | null {
  return typeof storeNumber === "number" && storeNumber > 0 ? `BCSID-${String(storeNumber).padStart(4, "0")}` : null;
}
