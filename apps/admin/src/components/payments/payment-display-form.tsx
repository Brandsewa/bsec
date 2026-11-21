import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, X } from "lucide-react";
import { Button, Field, Input, toast } from "@bs/ui";
import type { CheckoutSettings } from "@bs/contracts";
import { MediaPickerDialog } from "@bs/content-admin/media/media-picker-dialog.tsx";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

interface Logo {
  url: string;
  alt: string;
}

const MAX_LOGOS = 6;

/**
 * What shoppers read on this gateway's payment option at checkout: a title, a line of small print and a strip of small
 * card or wallet images (Visa, UPI...) shown on the right. Empty fields fall back to the built-in wording. Stored with the
 * store's checkout settings, so it needs the checkout permission and never touches the gateway keys.
 */
export function PaymentDisplayForm({ provider, providerName, disabled }: { provider: string; providerName: string; disabled: boolean }) {
  const settings = useQuery(orpc.admin.checkoutSettings.get.queryOptions());
  if (!settings.data) return null;
  // Keyed by the settings version so a save (or a change made elsewhere) reloads the fields.
  return <PaymentDisplayFields key={settings.data.updatedAt ?? "new"} provider={provider} providerName={providerName} disabled={disabled} settings={settings.data} />;
}

function PaymentDisplayFields({ provider, providerName, disabled, settings }: { provider: string; providerName: string; disabled: boolean; settings: CheckoutSettings }) {
  const queryClient = useQueryClient();
  const saved = settings.display.payment[provider];
  const [title, setTitle] = useState(saved?.title ?? "");
  const [subtitle, setSubtitle] = useState(saved?.subtitle ?? "");
  const [logos, setLogos] = useState<Logo[]>(saved?.logos ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);

  const save = useMutation(
    orpc.admin.checkoutSettings.update.mutationOptions({
      onSuccess: () => {
        toast.success("Payment option text saved");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.checkoutSettings.key() });
      },
      onError: (err) => toast.error(errorMessage(err)),
    }),
  );

  const dirty = title !== (saved?.title ?? "") || subtitle !== (saved?.subtitle ?? "") || JSON.stringify(logos) !== JSON.stringify(saved?.logos ?? []);

  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled || !dirty) return;
        save.mutate({
          display: { payment: { [provider]: { title: title.trim(), subtitle: subtitle.trim(), logos } } },
          expectedUpdatedAt: settings.updatedAt,
        });
      }}
    >
      <div>
        <p className="font-medium text-foreground">Checkout appearance</p>
        <p className="text-muted-foreground">How {providerName} appears in the payment step. Leave a field empty to use the default wording.</p>
      </div>
      <Field id={`gw-${provider}-title`} label="Title">
        <Input id={`gw-${provider}-title`} value={title} maxLength={80} disabled={disabled} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. UPI / Card / NetBanking" />
      </Field>
      <Field id={`gw-${provider}-subtitle`} label="Subtext">
        <Input id={`gw-${provider}-subtitle`} value={subtitle} maxLength={160} disabled={disabled} onChange={(e) => setSubtitle(e.target.value)} placeholder="e.g. Pay securely online" />
      </Field>

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">Logos on the right (up to {MAX_LOGOS})</p>
        {logos.length > 0 ? (
          <ul className="space-y-1.5">
            {logos.map((l, i) => (
              <li key={`${l.url}-${i}`} className="flex items-center gap-2 rounded-md border border-border p-1.5">
                <img src={l.url} alt="" className="h-7 w-10 shrink-0 object-contain" />
                <Input
                  aria-label={`Description for logo ${i + 1}`}
                  value={l.alt}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(e) => setLogos((prev) => prev.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
                  placeholder="Describe the image, e.g. Visa"
                  className="h-8 flex-1"
                />
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={disabled} aria-label={`Remove logo ${i + 1}`} onClick={() => setLogos((prev) => prev.filter((_, j) => j !== i))}>
                  <X className="size-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <Button type="button" variant="outline" size="sm" disabled={disabled || logos.length >= MAX_LOGOS} onClick={() => setPickerOpen(true)}>
          <ImagePlus className="mr-1.5 size-3.5" aria-hidden /> Add images
        </Button>
        <MediaPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          accept={["image"]}
          multiple
          title="Select payment logos"
          onSelect={(selected) => {
            setLogos((prev) => {
              const next = [...prev];
              for (const item of selected) {
                if (!item.url || next.length >= MAX_LOGOS || next.some((x) => x.url === item.url)) continue;
                next.push({ url: item.url, alt: item.alt ?? item.title ?? item.filename ?? "" });
              }
              return next;
            });
          }}
        />
      </div>

      <Button type="submit" size="sm" disabled={disabled || !dirty || save.isPending}>
        {save.isPending ? "Saving…" : "Save appearance"}
      </Button>
    </form>
  );
}
