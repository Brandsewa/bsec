import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Input,
  PageContainer,
  PageHeader,
  PageSkeleton,
  SimpleSelect,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bs/ui";
import { formatMoney } from "@bs/contracts/money";
import { client } from "../lib/orpc.ts";

type Tab = "invoices" | "transactions";

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "created", label: "Created" },
  { value: "captured", label: "Captured" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
];
const PROVIDER_OPTIONS = [
  { value: "", label: "Any method" },
  { value: "cod", label: "Cash on delivery" },
  { value: "razorpay", label: "Razorpay" },
  { value: "cashfree", label: "Cashfree" },
  { value: "stripe", label: "Stripe" },
  { value: "paypal", label: "PayPal" },
];

const tone = (status: string): "success" | "destructive" | "neutral" => (["paid", "captured"].includes(status) ? "success" : ["failed", "void"].includes(status) ? "destructive" : "neutral");

function PlatformInvoices() {
  const { data, isLoading } = useQuery({ queryKey: ["platform", "invoices"], queryFn: () => client.plans.invoices({ limit: 100 }) });
  if (isLoading) return <PageSkeleton />;
  if (!data || data.length === 0) {
    return <div className="rounded-xl border border-border bg-card p-6 text-center text-xs text-muted-foreground">No platform invoices issued yet.</div>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="px-4">Invoice #</TableHead>
            <TableHead>Store</TableHead>
            <TableHead>Taxable amount</TableHead>
            <TableHead>GST</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="px-4 text-right">Issued</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((inv) => (
            <TableRow key={inv.id} className="transition-colors hover:bg-muted/30">
              <TableCell className="px-4 font-mono text-xs font-semibold">{inv.number}</TableCell>
              <TableCell className="text-xs">{inv.tenantName || inv.tenantId}</TableCell>
              <TableCell className="text-xs">{formatMoney(inv.amountPaise, "INR")}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{formatMoney(inv.taxPaise, "INR")}</TableCell>
              <TableCell className="text-xs font-semibold">{formatMoney(inv.amountPaise + inv.taxPaise, "INR")}</TableCell>
              <TableCell>
                <StatusBadge tone={tone(inv.status)} label={inv.status} />
              </TableCell>
              <TableCell className="px-4 text-right text-xs text-muted-foreground">{new Date(inv.issuedAt).toLocaleDateString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StoreTransactions() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["platform", "store-transactions", search, status, provider],
    queryFn: () =>
      client.ledger.storeTransactions({
        limit: 100,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(status ? { status } : {}),
        ...(provider ? { provider } : {}),
      }),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search store or order number" className="h-9 w-64" aria-label="Search" />
        <SimpleSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} ariaLabel="Status" className="w-40" />
        <SimpleSelect value={provider} onChange={setProvider} options={PROVIDER_OPTIONS} ariaLabel="Payment method" className="w-44" />
      </div>
      {isLoading ? (
        <PageSkeleton />
      ) : !data || data.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-xs text-muted-foreground">No store transactions match.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Date</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="px-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((t) => (
                <TableRow key={t.id} className="transition-colors hover:bg-muted/30">
                  <TableCell className="px-4 text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{t.tenantName}</TableCell>
                  <TableCell className="font-mono text-xs">{t.orderNumber ?? "-"}</TableCell>
                  <TableCell className="text-xs capitalize">{t.provider}</TableCell>
                  <TableCell className="text-xs font-semibold">{formatMoney(t.amount, t.currency)}</TableCell>
                  <TableCell className="px-4">
                    <StatusBadge tone={tone(t.status)} label={t.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function Ledger() {
  const [tab, setTab] = useState<Tab>("invoices");
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "invoices", label: "Platform invoices" },
    { id: "transactions", label: "Store transactions" },
  ];
  return (
    <PageContainer size="full">
      <PageHeader
        title="Invoices and transactions"
        description="Platform invoices (what merchants pay Brand Sewa for their plan) and the payments taking place in merchants' stores."
      />
      <div className="mb-4 flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "invoices" ? <PlatformInvoices /> : <StoreTransactions />}
    </PageContainer>
  );
}
