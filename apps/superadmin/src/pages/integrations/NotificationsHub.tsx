import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Mail,
  MessageSquare,
  Phone,
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

export function NotificationsHub() {
  const navigate = useNavigate();

  const { data: overview, isLoading } = useQuery({
    queryKey: ["platform", "integrations", "overview"],
    queryFn: () => client.integrations.overview(),
  });

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader
          title="Notification Channels"
          description="Manage transactional email, SMS, and WhatsApp messaging."
        />
        <MetricCardsSkeleton count={3} />
      </PageContainer>
    );
  }

  const email = overview?.channels.email;
  const emailStatus = email?.status ?? "not_configured";

  return (
    <PageContainer>
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => navigate({ to: "/integrations" })}
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Integrations</span>
        </Button>
      </div>

      <PageHeader
        title="Notification Channels"
        description="Configure platform messaging providers, view delivery logs, and monitor delivery health."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
        {/* Email Card */}
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
            <CardTitle className="text-xl">Email</CardTitle>
            <CardDescription>
              Transactional email via Zoho ZeptoMail SMTP and custom SMTP relays.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="rounded-md border border-border/60 p-3 space-y-1.5 bg-muted/30 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Provider:</span>
                <span className="font-semibold">{email?.provider === "zoho_zeptomail" ? "Zoho ZeptoMail" : "Custom SMTP"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sent (last 7 days):</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{email?.sent7d ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Failed (last 7 days):</span>
                <span className="font-semibold text-destructive">{email?.failed7d ?? 0}</span>
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Button
              className="w-full justify-between"
              onClick={() => navigate({ to: "/integrations/notifications/email" })}
            >
              <span>View Channel</span>
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardFooter>
        </Card>

        {/* SMS Card */}
        <Card className="flex flex-col justify-between hover:border-primary/40 transition-colors">
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-500">
                <Phone className="h-6 w-6" />
              </div>
              <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/30">
                Not enrolled
              </Badge>
            </div>
            <CardTitle className="text-xl">SMS (Zoho CPaaS)</CardTitle>
            <CardDescription>
              Transactional OTP and status alerts via India DC CPaaS. Requires TRAI DLT registration.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="rounded-md border border-border/60 p-3 space-y-1.5 bg-muted/30 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Provider:</span>
                <span className="font-semibold">Zoho CPaaS (IN DC)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className="text-amber-600 dark:text-amber-400">Account not enrolled</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Volume (7d):</span>
                <span className="font-semibold">0 sent</span>
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Button
              variant="outline"
              className="w-full justify-between"
              onClick={() => navigate({ to: "/integrations/notifications/sms" })}
            >
              <span>View Channel</span>
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardFooter>
        </Card>

        {/* WhatsApp Card */}
        <Card className="flex flex-col justify-between hover:border-primary/40 transition-colors">
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <div className="p-2.5 rounded-lg bg-green-500/10 text-green-500">
                <MessageSquare className="h-6 w-6" />
              </div>
              <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/30">
                Not enrolled
              </Badge>
            </div>
            <CardTitle className="text-xl">WhatsApp (Zoho CPaaS)</CardTitle>
            <CardDescription>
              Pre-approved template notifications via WhatsApp Business API / Zoho CPaaS.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="rounded-md border border-border/60 p-3 space-y-1.5 bg-muted/30 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Provider:</span>
                <span className="font-semibold">Zoho CPaaS (WABA)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className="text-amber-600 dark:text-amber-400">WABA not enrolled</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Volume (7d):</span>
                <span className="font-semibold">0 sent</span>
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Button
              variant="outline"
              className="w-full justify-between"
              onClick={() => navigate({ to: "/integrations/notifications/whatsapp" })}
            >
              <span>View Channel</span>
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    </PageContainer>
  );
}
