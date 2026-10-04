import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Copy, Globe, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import type { CustomDomainItem } from "@bs/contracts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "../../../components/confirm-dialog.tsx";
import { Field } from "../../../components/field.tsx";
import { HeaderActions, SettingsPageFrame, SettingsSection } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/domains")({
  pendingComponent: () => <PageSkeleton />,
  component: DomainsSettingsPage,
});

const TITLE = "Domains";
const DESCRIPTION = "Connect and manage your custom domain so shoppers find your store at your own address.";

const FQDN_PATTERN = /^(?!:\/\/)([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;

export function DomainsSettingsPage() {
  const queryClient = useQueryClient();
  const domainsQuery = useQuery(orpc.admin.domains.list.queryOptions());

  const addDomain = useMutation(orpc.admin.domains.add.mutationOptions());
  const verifyDomain = useMutation(orpc.admin.domains.verify.mutationOptions());
  const setPrimary = useMutation(orpc.admin.domains.setPrimary.mutationOptions());
  const removeDomain = useMutation(orpc.admin.domains.remove.mutationOptions());

  const [isAdding, setIsAdding] = useState(false);
  const [hostname, setHostname] = useState("");
  const [prevalidateTxt, setPrevalidateTxt] = useState(false);
  const [domainToRemove, setDomainToRemove] = useState<CustomDomainItem | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: orpc.admin.domains.key() });
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    const clean = hostname.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!FQDN_PATTERN.test(clean)) {
      toast.error("Please enter a valid domain name (e.g. store.mydomain.com or mydomain.com).");
      return;
    }

    addDomain.mutate(
      { hostname: clean, prevalidateTxt },
      {
        onSuccess: () => {
          setHostname("");
          setPrevalidateTxt(false);
          setIsAdding(false);
          refresh();
          toast.success("Domain added. Please configure DNS records.");
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  function handleVerify(id: string) {
    setVerifyingId(id);
    verifyDomain.mutate(
      { id },
      {
        onSuccess: (res) => {
          refresh();
          if (res.status === "active") {
            toast.success("Domain verified and active!");
          } else {
            toast.info(`Verification status: ${res.status.replace("_", " ")}. DNS changes may take some time to propagate.`);
          }
          setVerifyingId(null);
        },
        onError: (err) => {
          setVerifyingId(null);
          toast.error(errorMessage(err));
        },
      },
    );
  }

  function handleSetPrimary(id: string) {
    setPrimary.mutate(
      { id },
      {
        onSuccess: () => {
          refresh();
          toast.success("Primary domain updated.");
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  function handleRemove() {
    if (!domainToRemove) return;
    removeDomain.mutate(
      { id: domainToRemove.id },
      {
        onSuccess: () => {
          setDomainToRemove(null);
          refresh();
          toast.success("Domain disconnected.");
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  }

  function copy(text: string, label: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => toast.success(`Copied ${label} to clipboard`),
        () => toast.error(`Could not copy ${label}`),
      );
    }
  }

  if (domainsQuery.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <FormSkeleton />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  if (domainsQuery.isError || !domainsQuery.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load domains"
            description={errorMessage(domainsQuery.error)}
            action={<Button onClick={() => void domainsQuery.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }

  const domains = domainsQuery.data;

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      <HeaderActions>
        {!isAdding && (
          <Button onClick={() => setIsAdding(true)}>
            <Plus className="mr-1.5 size-4" aria-hidden />
            Add custom domain
          </Button>
        )}
      </HeaderActions>

      <ConfirmDialog
        open={Boolean(domainToRemove)}
        onOpenChange={(open) => {
          if (!open) setDomainToRemove(null);
        }}
        title="Remove domain?"
        description={
          domainToRemove ? (
            <span>
              Are you sure you want to disconnect <strong>{domainToRemove.hostname}</strong>? Shoppers will no longer be able to reach your store at this domain.
            </span>
          ) : (
            ""
          )
        }
        confirmLabel="Remove domain"
        destructive
        pending={removeDomain.isPending}
        onConfirm={handleRemove}
      />

      {isAdding && (
        <SettingsSection title="Add custom domain" description="Enter the domain or subdomain you want to connect to this store.">
          <form onSubmit={handleAdd} className="space-y-4">
            <Field id="domain-hostname" label="Domain name" hint="For example, shop.mybrand.com or mybrand.com.">
              <Input
                id="domain-hostname"
                type="text"
                placeholder="shop.example.com"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                autoFocus
                required
              />
            </Field>

            <label className="flex items-start gap-2.5 text-xs text-foreground cursor-pointer">
              <Checkbox
                checked={prevalidateTxt}
                onCheckedChange={(checked) => setPrevalidateTxt(Boolean(checked))}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium block">Pre-validate ownership with a TXT record</span>
                <span className="text-muted-foreground block">
                  Verify domain ownership with your DNS provider before routing traffic (recommended for live stores switching hosts).
                </span>
              </span>
            </label>

            <div className="flex gap-2">
              <Button type="submit" disabled={addDomain.isPending || !hostname.trim()}>
                {addDomain.isPending ? "Adding…" : "Add domain"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setIsAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </SettingsSection>
      )}

      {domains.length === 0 && !isAdding ? (
        <SettingsSection>
          <EmptyState
            icon={Globe}
            title="No custom domains connected"
            description="Give your store a memorable, branded web address. You can connect a custom domain or subdomain that you own."
            action={
              <Button onClick={() => setIsAdding(true)}>
                <Plus className="mr-1.5 size-4" aria-hidden />
                Add domain
              </Button>
            }
          />
        </SettingsSection>
      ) : (
        domains.map((d) => {
          const isProviderDisabled = d.status === "requested" && d.sslStatus === "not_configured";
          const isActive = d.status === "active";
          const isPending = !isActive && !isProviderDisabled && d.status !== "failed";
          const isFailed = d.status === "failed";
          const isVerifying = verifyingId === d.id || verifyDomain.isPending;

          return (
            <SettingsSection key={d.id}>
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                  <div className="flex items-center gap-2.5">
                    <Globe className="size-4 text-muted-foreground" aria-hidden />
                    <span className="text-sm font-semibold text-foreground">{d.hostname}</span>
                    {d.isPrimary && (
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        Primary
                      </span>
                    )}
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="size-3" aria-hidden />
                        Active
                      </span>
                    )}
                    {d.sslStatus === "active" && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="size-3" aria-hidden />
                        SSL active
                      </span>
                    )}
                    {isPending && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                        <Clock className="size-3" aria-hidden />
                        Awaiting DNS
                      </span>
                    )}
                    {isFailed && (
                      <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                        <AlertTriangle className="size-3" aria-hidden />
                        Verification failed
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {!d.isPrimary && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isActive || setPrimary.isPending}
                        onClick={() => handleSetPrimary(d.id)}
                        title={!isActive ? "Domain must be active before it can be set as primary" : undefined}
                      >
                        Make primary
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => setDomainToRemove(d)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                      <span className="sr-only">Remove {d.hostname}</span>
                    </Button>
                  </div>
                </div>

                {isProviderDisabled && (
                  <div role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3.5 text-xs text-foreground">
                    <p className="font-medium text-amber-800 dark:text-amber-200">Domain provider not configured</p>
                    <p className="mt-1 text-muted-foreground">
                      Custom domain provisioning is not currently available on this platform. Store is accessible via your platform subdomain.
                    </p>
                  </div>
                )}

                {isFailed && (
                  <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3.5 text-xs text-foreground space-y-2">
                    <p className="font-medium text-destructive">DNS verification could not be completed</p>
                    <p className="text-muted-foreground">
                      DNS records could not be verified. Ensure your CNAME and TXT records are published with your DNS provider, then try again.
                    </p>
                    <div className="pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isVerifying}
                        onClick={() => handleVerify(d.id)}
                      >
                        <RefreshCw className={`mr-1.5 size-3.5 ${isVerifying ? "animate-spin" : ""}`} aria-hidden />
                        {isVerifying ? "Checking…" : "Re-verify domain"}
                      </Button>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        DNS updates can take up to 24-48 hours to propagate worldwide. Avoid rapid retries to respect provider rate limits.
                      </p>
                    </div>
                  </div>
                )}

                {isPending && (
                  <div className="space-y-3">
                    <div className="rounded-md border border-border bg-muted/40 p-3.5 text-xs">
                      <p className="font-medium text-foreground">DNS Configuration Required</p>
                      <p className="mt-0.5 text-muted-foreground">
                        Sign in to your domain registrar or DNS host (e.g. Cloudflare, GoDaddy, Namecheap) and add the following records:
                      </p>

                      <div className="mt-3 space-y-2 font-mono text-[11px]">
                        {/* CNAME Record */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded bg-background p-2.5 border border-border">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="font-bold text-foreground">CNAME</span>
                            <span className="text-muted-foreground">Name:</span>
                            <span className="text-foreground">{d.hostname}</span>
                            <span className="text-muted-foreground">Target:</span>
                            <span className="text-foreground">{d.verification?.cname || "stores.bcom.si"}</span>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => copy(d.verification?.cname || "stores.bcom.si", "CNAME target")}
                          >
                            <Copy className="size-3.5 mr-1" aria-hidden />
                            Copy target
                          </Button>
                        </div>

                        {/* TXT Record if pre-validation requested */}
                        {d.verification?.txt && (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded bg-background p-2.5 border border-border">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="font-bold text-foreground">TXT</span>
                              <span className="text-muted-foreground">Name:</span>
                              <span className="text-foreground">{d.verification.txt.name}</span>
                              <span className="text-muted-foreground">Value:</span>
                              <span className="text-foreground truncate max-w-xs">{d.verification.txt.value}</span>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => copy(d.verification!.txt!.value, "TXT verification value")}
                            >
                              <Copy className="size-3.5 mr-1" aria-hidden />
                              Copy value
                            </Button>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-border pt-3">
                        <Button
                          size="sm"
                          disabled={isVerifying}
                          onClick={() => handleVerify(d.id)}
                        >
                          <RefreshCw className={`mr-1.5 size-3.5 ${isVerifying ? "animate-spin" : ""}`} aria-hidden />
                          {isVerifying ? "Verifying…" : "Check verification"}
                        </Button>
                        <span className="text-[11px] text-muted-foreground">
                          DNS updates can take up to 24-48 hours to propagate worldwide.
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </SettingsSection>
          );
        })
      )}
    </SettingsPageFrame>
  );
}
