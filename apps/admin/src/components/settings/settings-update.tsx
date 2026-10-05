import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "@bs/ui";
import { Button } from "@bs/ui";
import { ConfirmDialog } from "@bs/ui";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

/**
 * "Settings update available": shown to the store owner only, and only while the platform has opened the offer.
 * Update now turns the new features on for this store; Don't update just closes the dialog and the banner stays.
 */
export function SettingsUpdateBanner() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const status = useQuery(orpc.admin.settingsUpdate.get.queryOptions());
  const apply = useMutation(orpc.admin.settingsUpdate.apply.mutationOptions());

  const data = status.data;
  if (!data?.available || !data.canApply) return null;

  function updateNow() {
    apply.mutate(undefined, {
      onSuccess: () => {
        setOpen(false);
        toast.success("Settings updated. The new features are on for your store");
        // New features change what several screens and the storefront do: refetch everything.
        void queryClient.invalidateQueries();
      },
      onError: (e) => {
        setOpen(false);
        toast.error(errorMessage(e));
      },
    });
  }

  return (
    <>
      <div
        role="status"
        className="mb-3 flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between lg:col-span-2"
      >
        <div className="flex items-start gap-2 text-xs text-foreground">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>New Settings features are ready for your store.</span>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Update available
        </Button>
      </div>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Update available"
        description="These new Settings features will be turned on for your store. You can keep working as you are and update later."
        confirmLabel="Update now"
        cancelLabel="Don't update"
        pending={apply.isPending}
        onConfirm={updateNow}
      >
        <ul className="list-disc space-y-1 pl-5 text-xs text-foreground">
          {data.features.map((f) => (
            <li key={f.key}>{f.label}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );
}
