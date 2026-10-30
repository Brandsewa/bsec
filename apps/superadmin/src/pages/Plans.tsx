import React from "react";
import { useQuery } from "@tanstack/react-query";
import { } from "lucide-react";
import {
  PageContainer,
  PageHeader,
  PageSkeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bs/ui";
import { formatMoney } from "@bs/contracts/money";
import { client } from "../lib/orpc.ts";

export function Plans() {
  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ["platform", "plans"],
    queryFn: () => client.plans.list(),
  });

  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ["platform", "invoices"],
    queryFn: () => client.plans.invoices({ limit: 50 }),
  });

  if (plansLoading || invoicesLoading) return <PageSkeleton />;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Plans & Billing"
        description="Platform subscription tiers and issued GST tax invoices for store hosting."
      />

      <div className="space-y-8">
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">Subscription Plans</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(plans || []).map((p) => {
              const maxExtraMarkets =
                p.features && typeof p.features === "object" && "max_extra_markets" in p.features
                  ? (p.features as Record<string, unknown>).max_extra_markets
                  : 1;

              return (
                <div key={p.id} className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-3 hover:border-primary/40 transition-colors">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-base text-foreground">{p.name}</h3>
                    <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground uppercase">{p.code}</span>
                  </div>
                  <div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-foreground">{formatMoney(p.priceMonthlyPaise, "INR")}</span>
                      <span className="text-xs text-muted-foreground"> / month</span>
                      {p.priceMonthlyUsdCents != null ? (
                        <span className="text-xs font-semibold text-muted-foreground ml-2">
                          ({formatMoney(p.priceMonthlyUsdCents, "USD")} USD)
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatMoney(p.priceYearlyPaise, "INR")} billed yearly
                      {p.priceYearlyUsdCents != null ? ` (${formatMoney(p.priceYearlyUsdCents, "USD")} USD)` : ""}
                    </div>
                  </div>
                  <div className="space-y-1 pt-2 border-t border-border/60 text-xs">
                    <div>
                      <span className="text-muted-foreground">Extra markets allowed: </span>
                      <strong className="font-semibold text-foreground">{String(maxExtraMarkets)}</strong>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Active Subscribers: </span>
                      <strong className="font-semibold text-foreground">{p.activeSubscribersCount} stores</strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">Issued Platform Invoices</h2>
          {!invoices || invoices.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-xs text-muted-foreground">
              No platform invoices issued yet.
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="px-4">Invoice #</TableHead>
                    <TableHead>Store / Tenant</TableHead>
                    <TableHead>Taxable Amount</TableHead>
                    <TableHead>GST (18%)</TableHead>
                    <TableHead>Total Paid</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right px-4">Issued Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono text-xs font-semibold px-4 text-foreground">{inv.number}</TableCell>
                      <TableCell className="text-xs">{inv.tenantName || inv.tenantId}</TableCell>
                      <TableCell className="text-xs">{formatMoney(inv.amountPaise, "INR")}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatMoney(inv.taxPaise, "INR")}</TableCell>
                      <TableCell className="text-xs font-semibold text-foreground">
                        {formatMoney(inv.amountPaise + inv.taxPaise, "INR")}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 capitalize">
                          {inv.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground text-right px-4">
                        {new Date(inv.issuedAt).toLocaleDateString("en-IN")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
