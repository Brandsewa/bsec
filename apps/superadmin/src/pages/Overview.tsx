import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CreditCard,
  Database,
  DollarSign,
  HardDrive,
  ShoppingBag,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import { Button, MetricCard, PageContainer, PageHeader, PageSkeleton } from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";

function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function Overview() {
  const { data: metrics, isLoading, error, refetch } = useQuery({
    queryKey: ["platform", "overview"],
    queryFn: () => client.overview.get(),
  });

  if (isLoading) return <PageSkeleton />;

  if (error || !metrics) {
    return (
      <PageContainer>
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive mb-2" />
          <h2 className="text-lg font-semibold text-destructive">Failed to load platform metrics</h2>
          <p className="text-sm text-muted-foreground mt-1">{messageOf(error, "Unknown error")}</p>
          <Button variant="default" size="sm" onClick={() => refetch()} className="mt-4">
            Retry
          </Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="full">
      <PageHeader
        title="Platform Overview"
        description="Live operational telemetry and key business metrics across all hosted stores."
        aside={
          <div className="flex items-center gap-2">
            <Link to={"/tenants/create"}>
              <Button size="sm">
                <Building2 className="mr-1.5 h-4 w-4" />
                Create Store
              </Button>
            </Link>
          </div>
        }
      />

      {/* Top Business Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <MetricCard
          label="Active Stores"
          value={metrics.activeStores.toString()}
          description={`Out of ${metrics.totalStores} total stores`}
          icon={Building2}
        />
        <MetricCard
          label="Monthly Recurring Revenue"
          value={formatRupees(metrics.mrrPaise)}
          description="Active subscription revenue"
          icon={CreditCard}
        />
        <MetricCard
          label="Platform GMV (All Time)"
          value={formatRupees(metrics.platformGmvPaise)}
          description="Gross merchandise volume"
          icon={DollarSign}
        />
        <MetricCard
          label="Orders Placed Today"
          value={metrics.ordersToday.toString()}
          description="Across all stores"
          icon={ShoppingBag}
        />
      </div>

      {/* Secondary Funnel & Health Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <MetricCard
          label="Signups (Last 7 Days)"
          value={metrics.newSignups7d.toString()}
          description={`${metrics.newSignups30d} in last 30 days`}
          icon={UserPlus}
        />
        <MetricCard
          label="Trial → Paid Conversion"
          value={`${metrics.conversionRatePct.toFixed(1)}%`}
          description="Conversion rate"
          icon={TrendingUp}
        />
        <MetricCard
          label="Failed Jobs (pg-boss)"
          value={metrics.failedJobsCount.toString()}
          description={metrics.failedJobsCount === 0 ? "Queues running clean" : "Attention needed"}
          icon={Activity}
        />
        <MetricCard
          label="Database Size"
          value={formatBytes(metrics.dbSizeBytes)}
          description="PostgreSQL total footprint"
          icon={HardDrive}
        />
      </div>

      {/* Operations Quick Action Cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between hover:border-primary/40 transition-colors">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm text-foreground">Store Provisioning</h3>
              <div className="p-1.5 rounded-md bg-muted text-foreground">
                <Building2 className="h-4 w-4" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Provision a new store with custom template, pricing tier, and single-use owner invite link.
            </p>
          </div>
          <Link to={"/tenants/create"} className="inline-flex items-center text-xs font-semibold text-primary hover:underline">
            Open creation form <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between hover:border-primary/40 transition-colors">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm text-foreground">Support Impersonation</h3>
              <div className="p-1.5 rounded-md bg-muted text-foreground">
                <Activity className="h-4 w-4" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Audited, time-boxed support sessions with required merchant consent or emergency overrides.
            </p>
          </div>
          <Link to={"/support"} className="inline-flex items-center text-xs font-semibold text-primary hover:underline">
            View active sessions <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-xs flex flex-col justify-between hover:border-primary/40 transition-colors">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm text-foreground">System & Queues</h3>
              <div className="p-1.5 rounded-md bg-muted text-foreground">
                <Database className="h-4 w-4" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Inspect pg-boss background queues, retry failed jobs, and monitor webhook inbox errors.
            </p>
          </div>
          <Link to={"/system"} className="inline-flex items-center text-xs font-semibold text-primary hover:underline">
            Open system health <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}
