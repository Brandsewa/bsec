/**
 * The two per-tenant reads behind every access decision (store status and the indexing switch) are kept in memory for a few
 * seconds. Every page render, prefetch and API call evaluates access (the middleware, the layout and the page each do), so
 * without this each request paid for several database transactions that almost never change. A mode change (password,
 * maintenance, launch) shows within the TTL, and at once in the process that made it (invalidateCache clears it); a request
 * with a preview token or staff session is still decided per request. Off under test so tests see their own writes at once.
 */
export const ACCESS_READ_TTL_MS = process.env.VITEST ? 0 : 3000;
export type AccessReads = { at: number; statusRow: unknown; indexingEnabled: boolean };
export const accessReads = new Map<string, AccessReads>();

/** Forget a tenant's cached access reads (or all of them). */
export function clearStorefrontAccessCache(tenantId?: string): void {
  if (tenantId) accessReads.delete(tenantId);
  else accessReads.clear();
}
