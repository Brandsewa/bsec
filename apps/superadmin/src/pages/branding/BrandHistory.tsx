import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Badge, Button, ConfirmDialog, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, toast } from "@bs/ui";
import { client } from "../../lib/orpc.ts";
import { messageOf } from "../../lib/errors.ts";

/** Version history: the last 20 saves, with restore (as a new version) for platform_admin and above. */
export function BrandHistory({ canEdit, currentVersion }: { canEdit: boolean; currentVersion: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<number | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["platform", "branding", "history"], queryFn: () => client.branding.history(), enabled: open });
  const restore = useMutation({
    mutationFn: (version: number) => client.branding.restore({ version }),
    onSuccess: async () => {
      toast.success("Branding restored");
      setTarget(null);
      await qc.invalidateQueries({ queryKey: ["platform", "branding"] });
    },
    onError: (err) => toast.error(messageOf(err, "Could not restore branding")),
  });
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <History className="size-3.5" /> History
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Branding history</SheetTitle>
            <SheetDescription>The last 20 saves. Restoring saves the old values as a new version.</SheetDescription>
          </SheetHeader>
          <ul className="mt-4 grid gap-2 overflow-y-auto px-4">
            {isLoading ? <li className="text-sm text-muted-foreground">Loading...</li> : null}
            {data?.length === 0 ? <li className="text-sm text-muted-foreground">No saves recorded yet.</li> : null}
            {data?.map((v) => (
              <li key={v.version} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Version {v.version}</span>
                    {v.version === currentVersion ? <Badge variant="secondary">Current</Badge> : null}
                    {v.action === "restore" ? <Badge variant="outline">Restore</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()} {v.updatedByEmail ? `· ${v.updatedByEmail}` : ""}
                  </p>
                  <div className="mt-1.5 flex gap-1">
                    {[v.tokens.color.primary, v.tokens.color.secondary, v.tokens.button.light.background, v.tokens.button.dark.background].map((c, i) => (
                      <span key={i} className="size-4 rounded-sm border border-border" style={{ background: c }} />
                    ))}
                  </div>
                </div>
                {canEdit && v.version !== currentVersion ? (
                  <Button size="sm" variant="outline" onClick={() => setTarget(v.version)}>
                    Restore
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={`Restore version ${target ?? ""}?`}
        description="The platform brand changes everywhere straight away: website, dashboards, sign-in pages and platform emails."
        confirmLabel="Restore"
        pending={restore.isPending}
        onConfirm={() => target !== null && restore.mutate(target)}
      />
    </>
  );
}
