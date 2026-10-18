import { apiBase } from "./config.ts";
import { getActiveStoreId } from "./session.ts";
import { getSupportStoreId, getSupportToken } from "./support.ts";

/**
 * Downloads a platform invoice PDF through the API origin with the session cookie and store header (a plain link cannot
 * send `x-store-id`, same reason as the Finance CSV export).
 */
export async function downloadInvoicePdf(invoiceId: string, fallbackName: string): Promise<void> {
  const headers: Record<string, string> = {};
  const support = getSupportToken();
  const storeId = support ? getSupportStoreId() : getActiveStoreId();
  if (support) headers["x-support-token"] = support;
  if (storeId) headers["x-store-id"] = storeId;

  const res = await fetch(`${apiBase()}/api/admin/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`, { credentials: "include", headers });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // not JSON: keep the status message
    }
    throw new Error(message);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `invoice-${fallbackName}.pdf`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
