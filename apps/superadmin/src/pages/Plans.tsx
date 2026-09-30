import React from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, FileText, CheckCircle2, ShieldCheck } from "lucide-react";
import {
  EmptyState,
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
    <PageContainer>
      <PageHeader
        title="Plans & Billing"
        description="Platform subscription tiers and issued GST tax invoices for store hosting."
      />

      <div className="space-y-8">
        <div>
          <h2 className="text-base font-semibold mb-3">Subscription Plans</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(plans || []).map((p) => (
              <div key={p.id} className="rounded-xl border bg-card p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-base">{p.name}</h3>
                  <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-muted uppercase">{p.code}</span>
                </div>
                <div>
                  <span className="text-2xl font-bold">₹{(p.priceMonthlyPaise / 100).toLocaleString("en-IN")}</span>
                  <span className="text-xs text-muted-foreground"> / month</span>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    ₹{(p.priceYearlyPaise / 100).toLocaleString("en-IN")} billed yearly
                  </div>
                </div>
                <div className="pt-2 border-t text-xs">
                  <span className="text-muted-foreground">Active Subscribers: </span>
                  <strong className="font-semibold text-foreground">{p.activeSubscribersCount} stores</strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-base font-semibold mb-3">Issued Platform Invoices</h2>
          {!invoices || invoices.length === 0 ? (
            <div className="rounded-xl border bg-card p-6 text-center text-xs text-muted-foreground">
              No platform invoices issued yet.
            </div>
          ) : (
            <div className="rounded-xl border bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Store / Tenant</TableHead>
                    <TableHead>Taxable Amount</TableHead>
                    <TableHead>GST (18%)</TableHead>
                    <TableHead>Total Paid</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Issued Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs font-medium">{inv.number}</TableCell>
                      <TableCell className="text-xs">{inv.tenantName || inv.tenantId}</TableCell>
                      <TableCell className="text-xs">₹{(inv.amountPaise / 100).toFixed(2)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">₹{(inv.taxPaise / 100).toFixed(2)}</TableCell>
                      <TableCell className="text-xs font-semibold">
                        ₹{((inv.amountPaise + inv.taxPaise) / 100).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 capitalize">
                          {inv.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
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
