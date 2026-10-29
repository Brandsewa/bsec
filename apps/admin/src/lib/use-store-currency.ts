import { useQuery } from "@tanstack/react-query";
import { orpc } from "./orpc.ts";
import { DEFAULT_CURRENCY, normalizeCurrency } from "@bs/contracts/money";

/**
 * The store's BASE currency, for amounts that belong to the whole store (products, discounts, finance, reports).
 * It comes from the store settings first (readable by every staff role, kept equal to the base market's currency) and
 * only falls back to the base market, which needs the markets permission. Defaults to INR while loading.
 */
export function useStoreCurrency(): string {
  const settingsQuery = useQuery(orpc.admin.settings.get.queryOptions());
  const settingsCurrency = settingsQuery.data?.currency;
  const marketsQuery = useQuery({
    ...orpc.admin.markets.list.queryOptions({}),
    // Not asked at all when the settings already answered, so staff without the markets permission never trigger a 403.
    enabled: !settingsCurrency && !settingsQuery.isLoading,
    retry: false,
  });

  if (settingsCurrency) return normalizeCurrency(settingsCurrency);
  const baseMarket = marketsQuery.data?.markets?.find((m) => m.isBase);
  if (baseMarket?.currency) return normalizeCurrency(baseMarket.currency);
  return DEFAULT_CURRENCY;
}
