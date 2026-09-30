import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createORPCReactQueryUtils } from "@orpc/react-query";
import type { PlatformClient } from "@bs/contracts";
import { apiBase } from "./config.ts";

export const rpcLink = new RPCLink({
  url: () => `${apiBase()}/api/rpc`,
  fetch: (request, init) => fetch(request, { ...init, credentials: "include" }),
});

export const client = createORPCClient<PlatformClient>(rpcLink);
export const orpc = createORPCReactQueryUtils(client);
