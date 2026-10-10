import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  CreditCard,
  HardDrive,
  Mail,
  MessageSquare,
  Phone,
  ArrowRight,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  PageContainer,
  PageHeader,
  MetricCardsSkeleton,
} from "@bs/ui";
import { client } from "../../lib/orpc.ts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function IntegrationsHub() {
  const navigate = useNavigate();

  const { data: overview, isLoading } = useQuery({
    queryKey: ["platform", "integrations", "overview"],
    queryFn: () => client.integrations.overview(),
  });

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader
          title="Integrations Hub"
          description="Manage transactional notifications, file storage drivers, and payment gateways."
        />
        <MetricCardsSkeleton count={3} />
      </PageContainer>
    );
  }

  const emailStatus = overview?.channels.email.status ?? "not_configured";
  const emailSent7d = overview?.channels.email.sent7d ?? 0;
  const emailFailed7d = overview?.channels.email.failed7d ?? 0;

  const storageActive = overview?.storage.activeConnections ?? 0;
  const storageBytes = overview?.storage.totalBytes ?? 0;
  const storageFiles = overview?.storage.totalFiles ?? 0;

  return (
    <PageContainer>
      <PageHeader
        title="Integrations Hub"
        description="Centralised configuration for messaging channels, object storage drivers, and payment provider enablement."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
        {/* Card 1: Notifications */}
        <Card className="flex flex-col justify-between hover:border-primary/40 transition-colors">
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2.5 rounded-lg bg-primary/10 text-primary">
                <Mail className="h-6 w-6" />
              </div>
              <Badge variant={emailStatus === "active" ? "default" : emailStatus === "failing" ? "destructive" : "secondary"}>
                {emailStatus === "active" ? "Active" : emailStatus === "failing" ? "Failing" : "Not configured"}
              </Badge>
            </div>
            <CardTitle className="text-xl">Notifications</CardTitle>
            <CardDescription>
              Transactional email (ZeptoMail/SMTP), SMS, and WhatsApp messaging channels.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="rounded-md border border-border/60 p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" /> Email
                </span>
                <span className="text-muted-foreground">
                  {emailSent7d} sent, {emailFailed7d} failed (7d)
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" /> SMS (Zoho CPaaS)
                </span>
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-amber-600 dark:text-amber-400">
                  Not enrolled
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium">
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" /> WhatsApp (Zoho)
                </span>
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-amber-600 dark:text-amber-400">
                  Not enrolled
                </Badge>
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Button
              className="w-full justify-between"
              onClick={() => navigate({ to: "/integrations/notifications" })}
            >
              <span>Manage Notifications</span>
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardFooter>
        </Card>

        {/* Card 2: Storage */}
        <Card className="flex flex-col justify-between hover:border-primary/40 transition-colors">
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-500">
                <HardDrive className="h-6 w-6" />
              </div>
              <Badge variant={storageActive > 0 ? "default" : "secondary"}>
                {storageActive > 0 ? `${storageActive} Active` : "No Drivers"}
              </Badge>
            </div>
            <CardTitle className="text-xl">Storage Drivers</CardTitle>
            <CardDescription>
              Cloudflare R2, AWS S3, and local filesystem drivers for product images and digital assets.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="rounded-md border border-border/60 p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Total Files:</span>
                <span className="font-semibold">{storageFiles.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Total Storage Used:</span>
                <span className="font-semibold">{formatBytes(storageBytes)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Active Connections:</span>
                <span className="font-semibold">{storageActive}</span>
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Button
              className="w-full justify-between"
              onClick={() => navigate({ to: "/integrations/storage" })}
            >
              <span>Manage Storage</span>
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardFooter>
        </Card>

        {/* Card 3: Payments */}
        <Card className="flex flex-col justify-between hover:border-primary/40 transition-colors">
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                <CreditCard className="h-6 w-6" />
              </div>
              <Badge variant="outline" className="text-emerald-600 border-emerald-500/30">
                Test Mode Ready
              </Badge>
            </div>
            <CardTitle className="text-xl">Payment Gateways</CardTitle>
            <CardDescription>
              Platform-level payment provider switches (Razorpay & Stripe) for tenant store checkouts.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="rounded-md border border-border/60 p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">Razorpay</span>
                <Badge variant="default" className="text-[10px] py-0 px-1.5">
                  Platform Enabled
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">Stripe</span>
                <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                  Ready to Enable
                </Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">PayPal</span>
                <span className="text-[10px] text-muted-foreground">Coming later</span>
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Button
              className="w-full justify-between"
              onClick={() => navigate({ to: "/integrations/payments" })}
            >
              <span>Manage Payments</span>
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    </PageContainer>
  );
}
