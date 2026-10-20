import { useQuery } from "@tanstack/react-query";
import { orpc } from "./orpc.ts";

/**
 * The store's public address, or undefined while it loads or when the store has no hostname yet.
 * On a developer machine the store lives at <slug>.localhost on the web app's port, over plain http.
 */
export function useStorefrontUrl(): string | undefined {
  const overview = useQuery(orpc.admin.settingsOverview.get.queryOptions());
  const raw = overview.data?.storeStatus.storefrontUrl?.replace(/\/+$/, "");
  if (!raw) return undefined;
  return /^https:\/\/[^/]+\.localhost$/i.test(raw) ? `${raw.replace("https://", "http://")}:3000` : raw;
}

/** Absolute storefront link for a path such as `/products/denim-jacket`. */
export function storefrontLink(base: string | undefined, path: string): string | undefined {
  return base ? `${base}${path.startsWith("/") ? path : `/${path}`}` : undefined;
}
