import { useState } from "react";
import { Link, createFileRoute, useParams, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Power, PowerOff } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  PageSkeleton,
  ScrollTabs,
  toast,
} from "@bs/ui";
import { HeaderActions, SettingsCard, SettingsPageFrame } from "../../../components/settings/settings-page.tsx";
import { MarketBadge } from "../../../components/markets/market-badge.tsx";
import { MarketReadinessCard } from "../../../components/markets/market-readiness.tsx";
import { MarketGeneralTab } from "../../../components/markets/market-general-tab.tsx";
import { MarketPricingTab } from "../../../components/markets/market-pricing-tab.tsx";
import { MarketCatalogTab } from "../../../components/markets/market-catalog-tab.tsx";
import { MarketPaymentsTab } from "../../../components/markets/market-payments-tab.tsx";
import { MarketShippingTab } from "../../../components/markets/market-shipping-tab.tsx";
import { MarketPoliciesTab } from "../../../components/markets/market-policies-tab.tsx";
import { MarketTaxesTab } from "../../../components/markets/market-taxes-tab.tsx";
import { ComplianceAckCard } from "../../../components/markets/compliance-ack-card.tsx";
import { client, orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/markets_/$id")({
  pendingComponent: () => <PageSkeleton />,
  component: MarketDetailPage,
});

const TABS = [
  { id: "general", label: "General" },
  { id: "pricing", label: "Pricing & Currency" },
  { id: "catalog", label: "Catalog" },
  { id: "payments", label: "Payments" },
  { id: "shipping", label: "Shipping" },
  { id: "policies", label: "Returns & Cancellation" },
  { id: "taxes", label: "Taxes" },
] as const;

export function MarketDetailPage() {
  const { id } = useParams({ from: "/_store/settings/markets_/$id" });
  const { store } = useRouteContext({ from: "/_store" });
  const canManageMarkets = (store?.permissions ?? []).includes("markets.manage");

  const [activeTab, setActiveTab] = useState<string>("general");
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [statusConfirmOpen, setStatusConfirmOpen] = useState(false);

  const query = useQuery(orpc.admin.markets.get.queryOptions({ input: { id } }));
  const marketsListQuery = useQuery(orpc.admin.markets.list.queryOptions());

  if (query.isLoading) {
    return (
      <SettingsPageFrame title="Market Settings" description="Loading market details...">
        <PageSkeleton />
      </SettingsPageFrame>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SettingsPageFrame title="Market Settings" description="Market not found">
        <SettingsCard>
          <EmptyState
            icon={AlertCircle}
            title="Could not load market"
            description={errorMessage(query.error)}
            action={
              <Button asChild variant="outline">
                <Link to="/settings/markets">Back to Markets</Link>
              </Button>
            }
          />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  const market = query.data;
  const baseMarket = marketsListQuery.data?.markets.find((m) => m.isBase);
  const baseCurrency = baseMarket?.currency ?? "INR";
  const isReady = market.readiness.ready;
  const isActive = market.status === "active";

  async function handleToggleStatus() {
    setIsTogglingStatus(true);
    try {
      const nextStatus = isActive ? "disabled" : "active";
      await client.admin.markets.setStatus({
        id: market.id,
        status: nextStatus,
      });
      toast.success(`Market ${nextStatus === "active" ? "activated" : "disabled"}`);
      setStatusConfirmOpen(false);
      void query.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsTogglingStatus(false);
    }
  }

  return (
    <SettingsPageFrame
      title={market.name}
      description={`Market configuration for ${market.countries.join(", ") || "unassigned countries"} (${market.currency})`}
    >
      <HeaderActions>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings/markets">
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> All markets
            </Link>
          </Button>

          {!market.isBase && canManageMarkets ? (
            isActive ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatusConfirmOpen(true)}
                disabled={isTogglingStatus}
              >
                <PowerOff className="mr-1.5 h-3.5 w-3.5" /> Disable market
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => setStatusConfirmOpen(true)}
                disabled={isTogglingStatus || !isReady}
                title={!isReady ? "Complete all readiness checks before activating" : undefined}
              >
                <Power className="mr-1.5 h-3.5 w-3.5" /> Activate market
              </Button>
            )
          ) : null}
        </div>
      </HeaderActions>
      <div className="flex items-center justify-between gap-3">
        <MarketBadge status={market.status} isBase={market.isBase} />
        {!isActive && !market.isBase && !isReady ? (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            Cannot activate until readiness checks pass
          </span>
        ) : null}
      </div>

      {/* Readiness checklist card */}
      {!market.isBase ? (
        <MarketReadinessCard
          ready={market.readiness.ready}
          items={market.readiness.items}
          onGoToTab={(tab) => setActiveTab(tab)}
        />
      ) : null}

      {/* Tabs */}
      <div className="space-y-4">
        <ScrollTabs
          value={activeTab}
          onChange={setActiveTab}
          tabs={TABS}
        />

        <SettingsCard>
          {activeTab === "general" ? (
            <MarketGeneralTab market={market} onUpdated={() => void query.refetch()} />
          ) : null}

          {activeTab === "pricing" ? (
            <MarketPricingTab
              market={market}
              baseCurrency={baseCurrency}
              onUpdated={() => void query.refetch()}
            />
          ) : null}

          {activeTab === "catalog" ? (
            <MarketCatalogTab market={market} onUpdated={() => void query.refetch()} />
          ) : null}

          {activeTab === "payments" ? (
            <MarketPaymentsTab market={market} onUpdated={() => void query.refetch()} />
          ) : null}

          {activeTab === "shipping" ? (
            <MarketShippingTab market={market} />
          ) : null}

          {activeTab === "policies" ? (
            <MarketPoliciesTab market={market} onUpdated={() => void query.refetch()} />
          ) : null}

          {activeTab === "taxes" ? (
            <div className="space-y-6">
              <MarketTaxesTab market={market} onUpdated={() => void query.refetch()} />
              <ComplianceAckCard market={market} onUpdated={() => void query.refetch()} />
            </div>
          ) : null}
        </SettingsCard>
      </div>

      <ConfirmDialog
        open={statusConfirmOpen}
        onOpenChange={setStatusConfirmOpen}
        title={isActive ? `Disable market "${market.name}"?` : `Activate market "${market.name}"?`}
        description={
          isActive
            ? "Disabling this market will stop customer checkouts from its target countries and remove its regional currency pricing from storefront displays."
            : "Activating this market will expose its currency, catalog and pricing to shoppers from its assigned countries."
        }
        confirmLabel={isTogglingStatus ? "Updating…" : isActive ? "Disable Market" : "Activate Market"}
        destructive={isActive}
        onConfirm={handleToggleStatus}
      />
    </SettingsPageFrame>
  );
}
