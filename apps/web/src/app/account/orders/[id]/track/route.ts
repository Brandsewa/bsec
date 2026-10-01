import { mintOrderViewTokenForCustomer } from "@bs/domain";
import { currentCustomer, resolveStore } from "@/server/customer-session.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sends a signed-in shopper from their order to the existing /o/{token} page (tracking, returns) by minting a fresh
 * order link for an order they own. Anyone else gets bounced to the sign-in page.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await resolveStore(req);
  if (!store) return new Response("Not found", { status: 404 });
  const customer = await currentCustomer(store);
  const token = customer && UUID.test(id) ? await mintOrderViewTokenForCustomer(store.rt._db.db, store.tenantId, customer.id, id) : null;
  return new Response(null, {
    status: 302,
    headers: { Location: token ? `/o/${token}` : "/account", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
