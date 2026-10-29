import { useQuery } from "@tanstack/react-query";
import { orpc } from "./orpc.ts";
import { DEFAULT_CURRENCY, normalizeCurrency } from "@bs/contracts/money";

/**
 * Returns the store's BASE currency (base market currency / store settings).
 * Falls back to "INR" if markets or store settings are still loading or unavailable.
 */
export function useStoreCurrency(): string {
  const marketsQuery = useQuery(orpc.admin.markets.list.queryOptions({}));
  const settingsQuery = useQuery(orpc.admin.settings.get.queryOptions());

  const baseMarket = marketsQuery.data?.markets?.find((m) => m.isBase);
  if (baseMarket?.currency) {
    return normalizeCurrency(baseMarket.currency);
  }

  if (settingsQuery.data?.currency) {
    return normalizeCurrency(settingsQuery.data.currency);
  }

  return DEFAULT_CURRENCY;
}
