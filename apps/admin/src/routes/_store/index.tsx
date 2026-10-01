import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Circle,
  ArrowRight,
  Sparkles,
  Package,
  CreditCard,
  Globe,
  ShoppingBag,
  Store,
  X,
} from "lucide-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MetricCardSkeleton,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
} from "@bs/ui";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/")({
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    </PageSkeleton>
  ),
  component: HomePage,
});

interface ChecklistStep {
  id: string;
  title: string;
  description: string;
  icon: typeof Store;
  completed: boolean;
  href?: string;
  actionText?: string;
}

function HomePage() {
  const queryClient = useQueryClient();
  const [showDismissed, setShowDismissed] = useState(false);

  const { data: onboarding, isLoading } = useQuery(
    orpc.admin.onboarding.get.queryOptions({}),
  );

  const dismissMutation = useMutation(
    orpc.admin.onboarding.dismiss.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.admin.onboarding.get.key(),
        });
      },
    }),
  );

  // Only owners/admins can read the storefront mode; for everyone else the query fails quietly and no banner shows.
  const storefront = useQuery({ ...orpc.admin.storefront.getStatus.queryOptions(), retry: false });

  const steps = onboarding?.steps ?? {
    store_created: true,
    product_added: false,
    payment_configured: false,
    domain_connected: false,
    first_order_received: false,
  };

  const checklistItems: ChecklistStep[] = [
    {
      id: "store_created",
      title: "Store created",
      description: "Your store foundation, theme, and catalog structure are ready.",
      icon: Store,
      completed: Boolean(steps.store_created),
    },
    {
      id: "product_added",
      title: "Add your first product",
      description: "List products with pricing, photos, and inventory tracking.",
      icon: Package,
      completed: Boolean(steps.product_added),
      href: "/products/new",
      actionText: "Add product",
    },
    {
      id: "payment_configured",
      title: "Configure payments",
      description: "Enable Cash on Delivery (COD) or connect Razorpay payment gateway.",
      icon: CreditCard,
      completed: Boolean(steps.payment_configured),
      href: "/settings/payments",
      actionText: "Payment settings",
    },
    {
      id: "domain_connected",
      title: "Connect a custom domain",
      description: "Brand your store with your custom domain or gobs.cloud subdomain.",
      icon: Globe,
      completed: Boolean(steps.domain_connected),
      href: "/settings/branding",
      actionText: "Domain settings",
    },
    {
      id: "first_order_received",
      title: "Receive your first order",
      description: "Share your storefront with customers and process your first checkout.",
      icon: ShoppingBag,
      completed: Boolean(steps.first_order_received),
      href: "/orders",
      actionText: "View orders",
    },
  ];

  const completedCount = onboarding?.completedCount ?? (steps.store_created ? 1 : 0);
  const totalCount = onboarding?.totalCount ?? 5;
  const progressPercent = Math.round((completedCount / totalCount) * 100);
  const isDismissed = onboarding?.dismissed && !showDismissed;

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Home" }]} />
      <PageHeader
        title="Home"
        description="Welcome to your store control center. Manage products, orders, and storefront setup."
      />

      {storefront.data && storefront.data.mode !== "live" && (
        <Alert
          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          role="status"
          data-testid="storefront-not-live"
        >
          <div>
            <p className="font-semibold text-foreground">Your store is not live yet</p>
            <p className="text-sm text-muted-foreground">
              {storefront.data.mode === "coming_soon" && "Visitors see the coming-soon page."}
              {storefront.data.mode === "maintenance" && "Visitors see the maintenance page."}
              {storefront.data.mode === "password" && "Only people with the store password can see it."}{" "}
              Take it live when your products and payments are ready.
            </p>
          </div>
          <Button size="sm" nativeButton={false} render={<Link to="/settings/storefront" />}>
            Go live
          </Button>
        </Alert>
      )}

      {/* Setup Checklist Section */}
      <PageSection
        title="Setup checklist"
        description={
          !isDismissed
            ? `Complete ${totalCount} essential steps to start selling online.`
            : undefined
        }
      >
        {isLoading ? (
          <Card className="space-y-4 p-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3 w-full" />
            <div className="space-y-3 pt-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </Card>
        ) : isDismissed ? (
          <div className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/30 p-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Setup checklist dismissed ({completedCount}/{totalCount} steps completed)
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDismissed(true)}
            >
              Show checklist
            </Button>
          </div>
        ) : (
          <Card className="p-6 shadow-sm">
            {/* Header with Progress Bar */}
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground">
                    Get ready to launch
                  </h3>
                  <Badge variant="secondary">
                    {completedCount} of {totalCount} completed
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Follow these steps to set up your online store for customer orders.
                </p>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground self-start sm:self-auto"
                onClick={() => dismissMutation.mutate({})}
                disabled={dismissMutation.isPending}
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Dismiss
              </Button>
            </div>

            {/* Progress track */}
            <div className="mb-6">
              <Progress value={progressPercent} aria-label="Setup progress" />
            </div>

            {/* Steps list */}
            <div className="divide-y divide-border/60 rounded-lg border border-border/60 bg-background/50">
              {checklistItems.map((step) => (
                <div
                    key={step.id}
                    className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between transition-colors ${
                      step.completed ? "bg-muted/20" : "hover:bg-muted/10"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">
                        {step.completed ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-500" />
                        ) : (
                          <Circle className="h-5 w-5 text-muted-foreground/60" />
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <p
                            className={`text-sm font-medium ${
                              step.completed
                                ? "text-foreground line-through opacity-75"
                                : "text-foreground"
                            }`}
                          >
                            {step.title}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {step.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-end sm:shrink-0">
                      {step.completed ? (
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-500">
                          Done
                        </span>
                      ) : step.href ? (
                        <Button size="lg" nativeButton={false} render={<Link to={step.href} />}>
                          {step.actionText ?? "Start"}
                          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
            </div>

            {onboarding?.allCompleted && (
              <div className="mt-6 flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-50/50 p-4 dark:bg-emerald-950/20">
                <Sparkles className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <p className="text-sm font-medium text-emerald-900 dark:text-emerald-300">
                  Congratulations! All onboarding checklist steps are complete.
                </p>
              </div>
            )}
          </Card>
        )}
      </PageSection>
    </PageContainer>
  );
}
