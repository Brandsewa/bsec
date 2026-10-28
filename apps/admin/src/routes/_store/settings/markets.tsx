import { useState } from "react";
import { Link, createFileRoute, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, Plus, Trash2 } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  PageSkeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@bs/ui";
import { SettingsCard, SettingsPageFrame } from "../../../components/settings/settings-page.tsx";
import { MarketBadge } from "../../../components/markets/market-badge.tsx";
import { AddMarketDialog } from "../../../components/markets/add-market-dialog.tsx";
import { client, orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import type { MarketRecord } from "@bs/contracts";

export const Route = createFileRoute("/_store/settings/markets")({
  pendingComponent: () => <PageSkeleton />,
  component: MarketsListPage,
});

const TITLE = "Markets";
const DESCRIPTION = "Manage target countries, regional currencies, exchange rates, and international selling.";

export function MarketsListPage() {
  const navigate = useNavigate();
  const { store } = useRouteContext({ from: "/_store" });
  const canManageMarkets = (store?.permissions ?? []).includes("markets.manage");

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MarketRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const query = useQuery(orpc.admin.markets.list.queryOptions());

  if (query.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <PageSkeleton />
      </SettingsPageFrame>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsCard>
          <EmptyState
            icon={AlertCircle}
            title="Could not load markets"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsCard>
      </SettingsPageFrame>
    );
  }

  const { markets, extraMarketLimit } = query.data;
  const baseMarket = markets.find((m) => m.isBase);
  const baseCurrency = baseMarket?.currency ?? "INR";
  const extraMarketsCount = markets.filter((m) => !m.isBase).length;
  const canAddMore = extraMarketsCount < extraMarketLimit;

  async function handleDeleteMarket() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await client.admin.markets.delete({ id: deleteTarget.id });
      toast.success(`Market "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      void query.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {!canManageMarkets ? (
        <Alert role="alert">
          <span className="font-medium text-foreground">Read-only view:</span> Only store owners and administrators with markets management permissions can edit market settings.
        </Alert>
      ) : null}

      {/* Plan limit indicator */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-border bg-muted/20 p-4 text-xs">
        <div>
          <div className="font-medium text-foreground">
            {extraMarketsCount} of {extraMarketLimit} extra market{extraMarketLimit === 1 ? "" : "s"} used
          </div>
          <p className="text-muted-foreground mt-0.5">
            Your store subscription plan determines how many additional regional markets you can create alongside your base market.
          </p>
        </div>

        {canManageMarkets ? (
          <Button
            size="sm"
            onClick={() => setAddDialogOpen(true)}
            disabled={!canAddMore}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add market
          </Button>
        ) : null}
      </div>

      <SettingsCard title="All Markets" description="Countries, currencies and status across all regional markets.">
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Market</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Countries</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>URL Prefix</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {markets.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{m.name}</span>
                      {m.isBase ? (
                        <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px]">
                          Base
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <MarketBadge status={m.status} />
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground font-mono text-[11px]">
                      {m.countries.join(", ") || "None"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-[11px] font-medium text-foreground">{m.currency}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-[11px] text-muted-foreground">{m.pathPrefix ?? "/"}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        asChild
                      >
                        <Link to="/settings/markets/$id" params={{ id: m.id }}>
                          Manage <ArrowRight className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                      {!m.isBase && canManageMarkets ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(m)}
                          title="Delete market"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SettingsCard>

      <AddMarketDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        baseCurrency={baseCurrency}
        onCreated={(id) => {
          void query.refetch();
          void navigate({ to: "/settings/markets/$id", params: { id } });
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete market "${deleteTarget?.name}"?`}
        description="Deleting a market removes its regional prices, shipping zones, and tax rules. Markets with existing orders cannot be deleted."
        confirmLabel={isDeleting ? "Deleting…" : "Delete Market"}
        destructive
        onConfirm={handleDeleteMarket}
      />
    </SettingsPageFrame>
  );
}
