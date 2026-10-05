import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, CheckCircle2, HardDrive, Info, ShieldCheck, Sparkles } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton } from "@bs/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsPageFrame, SettingsSection } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/storage")({
  pendingComponent: () => <PageSkeleton />,
  component: StoragePage,
});

const TITLE = "Storage";
const DESCRIPTION = "View media storage usage, plan limits, and file breakdowns across your store.";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const KIND_LABELS: Record<string, { label: string; description: string }> = {
  product_images: { label: "Product images", description: "Catalog photos and variant gallery images" },
  brand_assets: { label: "Brand assets", description: "Logos, favicons, and social share graphics" },
  theme_assets: { label: "Theme assets", description: "Storefront banners and template illustrations" },
  other: { label: "Other media", description: "Additional uploaded store files" },
};

export function StoragePage() {
  const query = useQuery(orpc.admin.storageUsage.get.queryOptions());
  const routeContext = useRouteContext({ strict: false }) as { store?: { role?: string } } | undefined;
  const isOwner = routeContext?.store?.role === "store_owner";

  if (query.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <FormSkeleton />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load storage usage"
            description={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  const {
    usedBytes,
    limitBytes,
    mediaCount,
    percentUsed,
    state,
    providerLabel,
    publicMediaConfigured,
    maxUploadBytes,
    breakdown,
  } = query.data;

  const stateBadgeVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    ok: "secondary",
    warning: "outline",
    critical: "destructive",
    over: "destructive",
  };

  const stateLabels: Record<string, string> = {
    ok: "Healthy (<80%)",
    warning: "Warning (80-95%)",
    critical: "Near Limit (>95%)",
    over: "Quota Exceeded (>100%)",
  };

  const progressPercent = percentUsed !== null ? Math.min(Math.max(percentUsed, 0), 100) : 0;

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {/* Storage Overview Meter */}
      <SettingsSection
        title="Storage quota"
        description="Total media files uploaded to your store compared against your plan limit."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {formatBytes(usedBytes)}
              </span>
              <span className="text-sm text-muted-foreground">
                {limitBytes !== null ? ` of ${formatBytes(limitBytes)} used` : " used (unlimited)"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={stateBadgeVariant[state] ?? "secondary"} className="font-medium">
                {stateLabels[state] ?? state}
              </Badge>
              {percentUsed !== null && (
                <span className="text-sm font-semibold text-muted-foreground" aria-label={`${percentUsed}% of storage used`}>
                  {percentUsed}%
                </span>
              )}
            </div>
          </div>

          {/* Accessible Visual Progress Meter */}
          <div
            className="h-3 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percentUsed ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Storage usage progress"
          >
            <div
              className={`h-full transition-all ${
                state === "over" || state === "critical"
                  ? "bg-destructive"
                  : state === "warning"
                    ? "bg-amber-500"
                    : "bg-primary"
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {state === "over" && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive" role="alert">
              <AlertCircle className="size-4 shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="font-semibold">Storage quota exceeded</p>
                <p className="text-destructive/90">
                  Your store has exceeded its storage limit. New image and asset uploads will be refused until you delete unneeded media or upgrade your plan.
                </p>
              </div>
            </div>
          )}

          {state === "critical" && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400" role="alert">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="font-semibold">Storage almost full</p>
                <p className="text-amber-700/90 dark:text-amber-400/90">
                  You are approaching your plan limit. Consider cleaning up old images or requesting a larger plan to prevent upload disruptions.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between text-xs text-muted-foreground pt-1">
            <span>Total assets: <strong>{mediaCount.toLocaleString()}</strong> items</span>
            <span>Maximum single file upload: <strong>{formatBytes(maxUploadBytes)}</strong></span>
          </div>

          {isOwner && (
            <div className="pt-2">
              <Link to="/settings/plan-and-billing">
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Sparkles className="size-3.5 text-primary" aria-hidden />
                  Request a larger plan
                </Button>
              </Link>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* Category Breakdown */}
      <SettingsSection
        title="Asset breakdown"
        description="Usage grouped by asset type. Values reflect optimized original and variant files."
      >
        <div className="divide-y divide-border rounded-md border border-border">
          {breakdown.map((item) => {
            const info = KIND_LABELS[item.kind] ?? { label: item.kind, description: "Other uploads" };
            const itemPercent = usedBytes > 0 ? Math.round((item.bytes / usedBytes) * 100) : 0;
            return (
              <div key={item.kind} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 gap-2">
                <div>
                  <p className="text-xs font-medium text-foreground">{info.label}</p>
                  <p className="text-[11px] text-muted-foreground">{info.description}</p>
                </div>
                <div className="text-right sm:text-right">
                  <span className="text-xs font-semibold text-foreground">{formatBytes(item.bytes)}</span>
                  <span className="text-[11px] text-muted-foreground ml-2">
                    ({item.count.toLocaleString()} files, {itemPercent}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      {/* Infrastructure & Retention Details */}
      <SettingsSection
        title="Storage & retention policy"
        description="How files are stored, cached, delivered, and cleaned up."
      >
        <div className="space-y-3 text-xs text-muted-foreground">
          <div className="flex items-start gap-2.5">
            <HardDrive className="size-4 text-foreground shrink-0 mt-0.5" aria-hidden />
            <div>
              <p className="font-medium text-foreground">Storage provider</p>
              <p>{providerLabel} with distributed global edge CDN delivery.</p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" aria-hidden />
            <div>
              <p className="font-medium text-foreground">CDN delivery</p>
              <p>
                {publicMediaConfigured
                  ? "Public media CDN is active and serving optimized WebP/AVIF images to shoppers."
                  : "Standard edge media delivery is configured."}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <ShieldCheck className="size-4 text-foreground shrink-0 mt-0.5" aria-hidden />
            <div>
              <p className="font-medium text-foreground">Isolated private data</p>
              <p>
                Private customer return photos and sensitive documents are stored in dedicated isolated storage.
                They are neither exposed publicly nor counted towards this storefront media quota.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <Info className="size-4 text-foreground shrink-0 mt-0.5" aria-hidden />
            <div>
              <p className="font-medium text-foreground">Automatic retention pruning</p>
              <p>
                When products or brand assets are permanently removed, orphaned files are purged by scheduled platform maintenance sweeps to keep your quota tidy.
              </p>
            </div>
          </div>
        </div>
      </SettingsSection>
    </SettingsPageFrame>
  );
}
