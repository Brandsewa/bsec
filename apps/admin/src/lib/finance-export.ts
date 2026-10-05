import { apiBase } from "./config.ts";
import { getActiveStoreId } from "./session.ts";
import { getSupportStoreId, getSupportToken } from "./support.ts";

/**
 * Downloads a Finance CSV through the API origin with the session cookie and store header. A plain
 * link or `location.href` cannot do this: the admin SPA lives on a different origin than the API and a
 * navigation cannot send `x-store-id`. The server names the file (and signals truncation in the name).
 */
export async function downloadFinanceCsv(type: "ledger" | "expenses", period: string): Promise<void> {
  const headers: Record<string, string> = {};
  const support = getSupportToken();
  const storeId = support ? getSupportStoreId() : getActiveStoreId();
  if (support) headers["x-support-token"] = support;
  if (storeId) headers["x-store-id"] = storeId;

  const res = await fetch(`${apiBase()}/api/admin/finance/export?type=${type}&period=${encodeURIComponent(period)}`, {
    credentials: "include",
    headers,
  });
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // not JSON: keep the status message
    }
    throw new Error(message);
  }

  const disposition = res.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `finance-${type}-${period}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
