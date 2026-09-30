import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Button,
  EmptyState,
  FormSkeleton,
  Input,
  Label,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  toast,
} from "@bs/ui";
import type { StorefrontStatus } from "@bs/contracts";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/storefront")({
  pendingComponent: () => <PageSkeleton />,
  component: StorefrontSettingsPage,
});

type Mode = "live" | "coming_soon" | "maintenance" | "password";

const MODES: Array<{ value: Mode; title: string; description: string }> = [
  { value: "live", title: "Live", description: "Anyone can browse and buy from your store." },
  { value: "coming_soon", title: "Coming soon", description: "Visitors see a holding page, and can leave their email if you allow it." },
  { value: "maintenance", title: "Maintenance", description: "Visitors see a temporary \"back shortly\" page." },
  { value: "password", title: "Password protected", description: "Only people with the password can see the store." },
];

export function StorefrontSettingsPage() {
  const status = useQuery(orpc.admin.storefront.getStatus.queryOptions());

  return (
    <PageContainer size="small">
      <PageBreadcrumbs items={[{ label: "Settings" }, { label: "Storefront" }]} />
      <PageHeader
        title="Storefront"
        description="Choose whether customers can see and buy from your store. New stores start on the coming-soon page."
      />

      {status.isLoading ? (
        <FormSkeleton />
      ) : status.isError || !status.data ? (
        <EmptyState
          icon={AlertTriangle}
          title="Could not load storefront settings"
          description={errorMessage(status.error)}
          action={<Button onClick={() => void status.refetch()}>Try again</Button>}
        />
      ) : (
        <StorefrontForm current={status.data} />
      )}
    </PageContainer>
  );
}

function StorefrontForm({ current }: { current: StorefrontStatus }) {
  const queryClient = useQueryClient();
  const update = useMutation(orpc.admin.storefront.updateStatus.mutationOptions());

  const [mode, setMode] = useState<Mode>(current.mode);
  const [headline, setHeadline] = useState(current.headline ?? "");
  const [collectEmails, setCollectEmails] = useState(current.collectEmails);
  const [password, setPassword] = useState("");

  const needsPassword = mode === "password" && !current.hasPassword && password.length < 6;
  const unchanged =
    current.mode === mode &&
    (current.headline ?? "") === headline &&
    current.collectEmails === collectEmails &&
    password === "";

  function save() {
    update.mutate(
      {
        mode,
        headline: headline.trim() === "" ? null : headline.trim(),
        collectEmails,
        ...(password ? { password } : {}),
      },
      {
        onSuccess: (next) => {
          setPassword("");
          void queryClient.invalidateQueries({ queryKey: orpc.admin.storefront.key() });
          toast.success(next.mode === "live" ? "Your store is live." : "Storefront settings saved.");
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  return (
    <>
        {current.mode === "live" && (
          <div className="flex items-center gap-2 rounded-md border border-border p-3 text-sm" role="status">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Your store is live.
          </div>
        )}

        <PageSection title="Store visibility" description="You can change this at any time.">
          <fieldset className="grid gap-2" aria-label="Store visibility">
            {MODES.map((m) => (
              <label key={m.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm">
                <input
                  type="radio"
                  name="storefront-mode"
                  className="mt-1"
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                />
                <span>
                  <span className="block font-medium">{m.title}</span>
                  <span className="block text-foreground-lighter">{m.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </PageSection>

        {mode !== "live" && (
          <PageSection title="Holding page" description="What visitors see while the store is not live.">
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="storefront-headline">Headline</Label>
                <Input
                  id="storefront-headline"
                  value={headline}
                  maxLength={120}
                  placeholder="Opening soon"
                  onChange={(e) => setHeadline(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={collectEmails} onChange={(e) => setCollectEmails(e.target.checked)} />
                Let visitors leave their email to be notified
              </label>
            </div>
          </PageSection>
        )}

        {mode === "password" && (
          <PageSection
            title="Store password"
            description={current.hasPassword ? "A password is set. Enter a new one only if you want to change it." : "Set the password visitors must enter."}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="storefront-password">{current.hasPassword ? "New password" : "Password"}</Label>
              <Input
                id="storefront-password"
                type="password"
                autoComplete="new-password"
                value={password}
                minLength={6}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-foreground-lighter">At least 6 characters.</p>
            </div>
          </PageSection>
        )}

        <div className="flex justify-end">
          <Button onClick={save} disabled={update.isPending || unchanged || needsPassword}>
            {update.isPending ? "Saving…" : mode === "live" && current.mode !== "live" ? "Take my store live" : "Save"}
          </Button>
        </div>
    </>
  );
}
