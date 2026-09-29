import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createORPCReactQueryUtils } from "@orpc/react-query";
import { type StoreClient } from "@bs/contracts";
import { apiBase } from "./config.ts";
import { getActiveStoreId } from "./session.ts";

/**
 * oRPC client for the Store Admin SPA (PLAN §8, §11, ADR-005). Calls the web app's /api/rpc with the
 * staff session cookie (credentials: include). x-store-id only selects among the user's own stores.
 */
export const rpcLink = new RPCLink({
  url: () => `${apiBase()}/api/rpc`,
  headers: () => {
    const id = getActiveStoreId();
    return id ? { "x-store-id": id } : {};
  },
  fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
});

export const client = createORPCClient<StoreClient>(rpcLink);
export const orpc = createORPCReactQueryUtils(client);
