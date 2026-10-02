import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  RefreshCw,
} from "lucide-react";
import {
  Button,
  Input,
  Label,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";

export function TenantCreate() {
  const [storeName, setStoreName] = useState("");
  const [slug, setSlug] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [planCode, setPlanCode] = useState<"starter" | "growth" | "pro">("growth");
  const [themeTemplate, setThemeTemplate] = useState("starter-minimal");
  const [initialStatus, setInitialStatus] = useState<"trial" | "active" | "comped">("active");
  const [customDomain, setCustomDomain] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    tenantId: string;
    slug: string;
    inviteUrl: string;
    inviteToken: string;
  } | null>(null);

  const [copied, setCopied] = useState(false);
  const [resending, setResending] = useState(false);

  // Auto-slug generator from store name
  const handleStoreNameChange = (val: string) => {
    setStoreName(val);
    if (!slug || slug === autoSlug(storeName)) {
      setSlug(autoSlug(val));
    }
  };

  const autoSlug = (text: string) => {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 40);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await client.tenants.create({
        storeName: storeName.trim(),
        slug: slug.trim().toLowerCase(),
        clientEmail: clientEmail.trim().toLowerCase(),
        clientName: clientName.trim() || undefined,
        clientPhone: clientPhone.trim() || undefined,
        planCode,
        themeTemplate,
        state: initialStatus,
        customDomain: customDomain.trim() || undefined,
      });

      setResult({
        tenantId: res.tenantId,
        slug: res.slug,
        inviteUrl: res.inviteUrl,
        inviteToken: res.inviteToken,
      });
      toast.success(`Store '${storeName}' provisioned successfully`);
    } catch (err) {
      toast.error(messageOf(err, "Failed to provision store"));
    } finally {
      setLoading(false);
    }
  };

  const copyInvite = () => {
    if (!result?.inviteUrl) return;
    navigator.clipboard.writeText(result.inviteUrl);
    setCopied(true);
    toast.success("Invite link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleResend = async () => {
    if (!result?.tenantId) return;
    setResending(true);
    try {
      const res = await client.tenants.resendOwnerInvite({ id: result.tenantId, email: clientEmail.trim().toLowerCase() });
      setResult((prev) => (prev ? { ...prev, inviteUrl: res.inviteUrl, inviteToken: res.inviteToken } : null));
      toast.success("New invite link generated");
    } catch (err) {
      toast.error(messageOf(err, "Failed to resend invite"));
    } finally {
      setResending(false);
    }
  };

  return (
    <PageContainer size="small">
      <PageBreadcrumbs
        items={[
          { label: "Tenants", href: "/tenants" },
          { label: "Create Store" },
        ]}
      />

      <PageHeader
        title="Provision New Store"
        description="Creates an isolated store using provisionTenant(), seeds theme templates, and issues a single-use owner invite."
      />

      {result ? (
        <div className="rounded-xl border bg-card p-6 shadow-sm space-y-6">
          <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-8 w-8" />
            <div>
              <h2 className="text-lg font-bold text-foreground">Store Provisioned Successfully!</h2>
              <p className="text-xs text-muted-foreground font-mono">
                Store ID: {result.tenantId} · Slug: {result.slug}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-300">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold">Owner Onboarding Link Generated</strong>
                <p className="mt-1">
                  If the transactional email provider (Resend) is not configured in this environment, provide this single-use link directly to the merchant so they can set their password and activate their account.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Single-Use Owner Onboarding Link</Label>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={result.inviteUrl}
                className="font-mono text-xs select-all bg-muted"
              />
              <Button size="sm" onClick={copyInvite} className="shrink-0">
                {copied ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy Link"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This link is single-use and expires in 7 days. The owner creates their own password upon clicking.
            </p>
          </div>

          <div className="flex items-center justify-between pt-4 border-t">
            <Button
              variant="default"
              size="sm"
              onClick={handleResend}
              disabled={resending}
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${resending ? "animate-spin" : ""}`} />
              Resend / Regenerate Link
            </Button>

            <div className="flex items-center gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  setResult(null);
                  setStoreName("");
                  setSlug("");
                  setClientEmail("");
                }}
              >
                Provision Another Store
              </Button>
              <Link to={`/tenants/${result.tenantId}`}>
                <Button size="sm">Manage Store</Button>
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="rounded-xl border bg-card p-6 shadow-sm space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="storeName">Store / Business Name *</Label>
              <Input
                id="storeName"
                placeholder="e.g. Darjeeling Organics"
                value={storeName}
                onChange={(e) => handleStoreNameChange(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="slug">Subdomain Slug *</Label>
              <div className="flex items-center gap-1">
                <Input
                  id="slug"
                  placeholder="darjeeling-organics"
                  value={slug}
                  onChange={(e) => setSlug(autoSlug(e.target.value))}
                  required
                />
                <span className="text-xs text-muted-foreground shrink-0 font-mono">.bcom.si</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="clientEmail">Store Owner Email *</Label>
              <Input
                id="clientEmail"
                type="email"
                placeholder="owner@brand.in"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="clientName">Client Name</Label>
              <Input
                id="clientName"
                placeholder="e.g. Ramesh Sharma"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="clientPhone">Phone Number</Label>
              <Input
                id="clientPhone"
                placeholder="+91 98000 00000"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="planCode">Subscription Plan</Label>
              <Select value={planCode} onValueChange={(val) => setPlanCode(val as typeof planCode)}>
                <SelectTrigger id="planCode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter (₹999 / mo)</SelectItem>
                  <SelectItem value="growth">Growth (₹2,999 / mo)</SelectItem>
                  <SelectItem value="pro">Pro (₹7,999 / mo)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="initialStatus">Store Account State</Label>
              <Select value={initialStatus} onValueChange={(val) => setInitialStatus(val as typeof initialStatus)}>
                <SelectTrigger id="initialStatus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active (Comped / Agency Client)</SelectItem>
                  <SelectItem value="trial">Trial (14-day evaluation clock)</SelectItem>
                  <SelectItem value="comped">Comped (Internal / Partner)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="themeTemplate">Theme Template</Label>
              <Select value={themeTemplate} onValueChange={setThemeTemplate}>
                <SelectTrigger id="themeTemplate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter-minimal">Starter Minimal (Clean D2C)</SelectItem>
                  <SelectItem value="editorial-artisan">Artisan (Boutique & Craft)</SelectItem>
                  <SelectItem value="bold-grocer">Fresh & Food (FMCG Grocery)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="customDomain">Optional Custom Domain</Label>
            <Input
              id="customDomain"
              placeholder="e.g. shop.darjeelingorganics.in"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value.toLowerCase().trim())}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Can also be connected later by the merchant in Store Admin Settings.
            </p>
          </div>

          <div className="pt-2">
            <Button type="submit" disabled={loading} className="w-full sm:w-auto">
              {loading ? "Provisioning Database & Theme..." : "Provision Store & Generate Invite"}
            </Button>
          </div>
        </form>
      )}
    </PageContainer>
  );
}
