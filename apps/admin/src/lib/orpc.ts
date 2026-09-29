import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createORPCReactQueryUtils } from "@orpc/react-query";
import { type StoreClient } from "@bs/contracts";

/**
 * oRPC client setup for Store Admin SPA (PLAN §8, §11, ADR-005).
 * Connects to the store backend API mounted at /api/rpc.
 * Passes x-store-id header and credentials.
 */
export function getStoreId(): string {
  if (typeof window !== "undefined") {
    const fromStorage = localStorage.getItem("bs_active_store_id");
    if (fromStorage) return fromStorage;
    const fromUrl = new URLSearchParams(window.location.search).get("storeId");
    if (fromUrl) {
      localStorage.setItem("bs_active_store_id", fromUrl);
      return fromUrl;
    }
  }
  return "0199a000-0000-7000-8000-000000000001";
}

export const rpcLink = new RPCLink({
  url: typeof window !== "undefined" ? `${window.location.origin}/api/rpc` : "http://localhost:3000/api/rpc",
  headers: () => ({
    "x-store-id": getStoreId(),
  }),
  fetch: (request, init) => {
    return fetch(request, {
      ...init,
      credentials: "include",
    });
  },
});

export const client = createORPCClient<StoreClient>(rpcLink);
export const orpc = createORPCReactQueryUtils(client);

