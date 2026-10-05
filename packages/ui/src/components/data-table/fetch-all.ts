/** Pages through a server list (100 at a time) and returns everything, up to `cap` rows, for exports. */
export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ items: T[]; total: number }>,
  opts: { cap?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ rows: T[]; total: number }> {
  const cap = opts.cap ?? 5000;
  const rows: T[] = [];
  let total = Infinity;
  let offset = 0;
  while (offset < total && rows.length < cap) {
    const res = await fetchPage(offset, 100);
    total = res.total;
    rows.push(...res.items);
    opts.onProgress?.(rows.length, Math.min(cap, total));
    offset += 100;
    if (res.items.length === 0) break;
  }
  return { rows, total: Number.isFinite(total) ? total : rows.length };
}
