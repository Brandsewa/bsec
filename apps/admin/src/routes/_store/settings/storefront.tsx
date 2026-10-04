import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { EmptyState, FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import type { StorefrontStatus } from "@bs/contracts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ConfirmDialog } from "../../../components/confirm-dialog.tsx";
import { Field } from "../../../components/field.tsx";
import { HeaderActions, SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/storefront")({
  pendingComponent: () => <PageSkeleton />,
  component: StorefrontSettingsPage,
});

type Mode = "live" | "coming_soon" | "maintenance" | "password";

const MODES: Array<{ value: Mode; title: string; description: string }> = [
  { value: "live", title: "Live", description: "Anyone can browse, add to cart, and checkout." },
  { value: "coming_soon", title: "Coming soon", description: "Visitors see your holding page. They cannot browse products or checkout." },
  { value: "password", title: "Password protected", description: "Only visitors with the password can enter. Staff with admin sessions always have access." },
  { value: "maintenance", title: "Maintenance", description: "Returns a 503 Service Unavailable with Retry-After header. Use during planned maintenance." },
];

const TITLE = "Storefront";
const DESCRIPTION = "Choose whether customers can see and buy from your store. New stores start on the coming-soon page.";

export function StorefrontSettingsPage() {
  const status = useQuery(orpc.admin.storefront.getStatus.queryOptions());

  if (status.isLoading) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <FormSkeleton />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }
  if (status.isError || !status.data) {
    return (
      <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
        <SettingsSection>
          <EmptyState
            icon={AlertTriangle}
            title="Could not load storefront settings"
            description={errorMessage(status.error)}
            action={<Button onClick={() => void status.refetch()}>Try again</Button>}
          />
        </SettingsSection>
      </SettingsPageFrame>
    );
  }
  return <StorefrontForm current={status.data} />;
}

function StorefrontForm({ current }: { current: StorefrontStatus }) {
  const queryClient = useQueryClient();
  const update = useMutation(orpc.admin.storefront.updateStatus.mutationOptions());

  const [mode, setMode] = useState<Mode>(current.mode);
  const [headline, setHeadline] = useState(current.headline ?? "");
  const [collectEmails, setCollectEmails] = useState(current.collectEmails);
  const [password, setPassword] = useState("");
  const [confirmOfflineOpen, setConfirmOfflineOpen] = useState(false);

  const needsPassword = mode === "password" && !current.hasPassword && password.length < 6;
  const unchanged = current.mode === mode && (current.headline ?? "") === headline && current.collectEmails === collectEmails && password === "";
  const guard = useUnsavedGuard(!unchanged);

  function doSave() {
    update.mutate(
      {
        mode,
        headline: headline.trim() === "" ? null : headline.trim(),
        collectEmails,
        ...(password ? { password } : {}),
      },
      {
        onSuccess: () => {
          setPassword("");
          setConfirmOfflineOpen(false);
          void queryClient.invalidateQueries({ queryKey: orpc.admin.storefront.key() });
          toast.success("Saved. Live to shoppers within a minute");
        },
        onError: (e) => {
          setConfirmOfflineOpen(false);
          toast.error(errorMessage(e));
        },
      },
    );
  }

  function handleSave() {
    if (current.mode === "live" && mode !== "live") {
      setConfirmOfflineOpen(true);
    } else {
      doSave();
    }
  }

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      {guard}
      <ConfirmDialog
        open={confirmOfflineOpen}
        onOpenChange={setConfirmOfflineOpen}
        title="Take store offline?"
        description="Taking your store offline will prevent customers from browsing and purchasing."
        confirmLabel="Take offline"
        destructive
        pending={update.isPending}
        onConfirm={doSave}
      />
      <HeaderActions>
        <Button onClick={handleSave} disabled={update.isPending || unchanged || needsPassword}>
          {update.isPending ? "Saving…" : mode === "live" && current.mode !== "live" ? "Take my store live" : "Save changes"}
        </Button>
      </HeaderActions>

      {current.mode === "live" && (
        <SettingsSection>
          <div className="flex items-center gap-2 text-xs" role="status">
            <CheckCircle2 className="size-4 text-primary" aria-hidden />
            Your store is live.
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="Store visibility" description="You can change this at any time.">
        <RadioGroup aria-label="Store visibility" className="gap-2" value={mode} onValueChange={(v) => setMode(v as Mode)}>
          {MODES.map((m) => (
            <label key={m.value} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-data-checked:border-primary/50 has-data-checked:bg-muted">
              <RadioGroupItem value={m.value} className="mt-0.5" />
              <span>
                <span className="block text-xs font-medium text-foreground">{m.title}</span>
                <span className="block text-muted-foreground">{m.description}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </SettingsSection>

      {mode === "maintenance" && (
        <SettingsSection
          title="Maintenance mode"
          description="Maintenance mode serves an HTTP 503 Service Unavailable status with a Retry-After header so search engines do not de-index your site during brief downtime."
        >
          <p className="text-xs text-muted-foreground">
            Staff with active admin sessions can still browse and test the store. Regular visitors will receive an HTTP 503 response.
          </p>
        </SettingsSection>
      )}

      {mode !== "live" && (
        <SettingsSection title="Holding page" description="What visitors see while the store is not live.">
          <Field id="storefront-headline" label="Headline">
            <Input id="storefront-headline" value={headline} maxLength={120} placeholder="Opening soon" onChange={(e) => setHeadline(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <Checkbox checked={collectEmails} onCheckedChange={(c) => setCollectEmails(c)} />
            Let visitors leave their email to be notified
          </label>
        </SettingsSection>
      )}

      {mode === "password" && (
        <SettingsSection
          title="Store password"
          description={current.hasPassword ? "A password is set. Enter a new one only if you want to change it." : "Set the password visitors must enter."}
        >
          <Field id="storefront-password" label={current.hasPassword ? "New password" : "Password"} hint="At least 6 characters.">
            <Input id="storefront-password" type="password" autoComplete="new-password" value={password} minLength={6} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </SettingsSection>
      )}
    </SettingsPageFrame>
  );
}
