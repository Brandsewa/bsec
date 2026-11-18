import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button, Card, Input, Label, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { MediaPickerDialog } from "@bs/content-admin/media/media-picker-dialog.tsx";
import type { MediaItem } from "@bs/contracts";
import { client, orpc } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";
import { useHasRole } from "../lib/user-context.tsx";

interface Panel {
  heading: string;
  body: string;
  textColor: string;
  backgroundFrom: string;
  backgroundTo: string;
  imageUrl: string | null;
  verticalAlign: "top" | "middle" | "bottom";
}

function ColorField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-10 w-12 cursor-pointer rounded-md border border-border bg-transparent p-1" />
        <Input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="font-mono" />
      </div>
    </div>
  );
}

/** What merchants see beside the sign-in form on the store admin: text, colours and an optional picture. */
export function LoginPageSettings() {
  const query = useQuery(orpc.settings.getLoginPanel.queryOptions());
  if (!query.data) return <PageSkeleton />;
  const { explicit: _explicit, ...panel } = query.data;
  return <LoginPageForm initial={panel} />;
}

function LoginPageForm({ initial }: { initial: Panel }) {
  const canEdit = useHasRole("platform_admin");
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Panel>(initial);
  const [picking, setPicking] = useState(false);

  const save = useMutation({
    mutationFn: (input: Panel) => client.settings.updateLoginPanel(input),
    onSuccess: async () => {
      toast.success("Sign-in page saved. It can take about a minute to show for everyone.");
      await queryClient.invalidateQueries({ queryKey: orpc.settings.getLoginPanel.key() });
    },
    onError: (err) => toast.error(messageOf(err, "Could not save the sign-in page")),
  });

  const set = <K extends keyof Panel>(k: K, v: Panel[K]) => setForm({ ...form, [k]: v });
  const bg = {
    backgroundImage: `${form.imageUrl ? `url("${form.imageUrl}"), ` : ""}linear-gradient(135deg, ${form.backgroundFrom}, ${form.backgroundTo})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    color: form.textColor,
  };

  return (
    <PageContainer>
      <PageHeader title="Sign-in page" description="The panel next to the store admin sign-in form (admin.bcom.si). It takes 40% of the screen on desktop (the form gets 60%) and is hidden on phones and tablets, where only the form shows." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lp-heading">Heading</Label>
            <Input id="lp-heading" maxLength={80} value={form.heading} disabled={!canEdit} onChange={(e) => set("heading", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lp-body">Text</Label>
            <textarea id="lp-body" rows={3} maxLength={240} value={form.body} disabled={!canEdit} onChange={(e) => set("body", e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Heading and text position</Label>
            <div className="inline-flex w-fit overflow-hidden rounded-md border border-border" role="group" aria-label="Heading and text position">
              {(["top", "middle", "bottom"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={!canEdit}
                  aria-pressed={form.verticalAlign === v}
                  onClick={() => set("verticalAlign", v)}
                  className={`px-4 py-1.5 text-sm capitalize ${form.verticalAlign === v ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-muted"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <ColorField label="Background start" value={form.backgroundFrom} disabled={!canEdit} onChange={(v) => set("backgroundFrom", v)} />
            <ColorField label="Background end" value={form.backgroundTo} disabled={!canEdit} onChange={(v) => set("backgroundTo", v)} />
            <ColorField label="Text colour" value={form.textColor} disabled={!canEdit} onChange={(v) => set("textColor", v)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Background picture (optional)</Label>
            <div className="flex items-center gap-3">
              <div className="flex h-20 w-32 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                {form.imageUrl ? <img src={form.imageUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">Not set</span>}
              </div>
              {canEdit ? (
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setPicking(true)}>
                    <ImagePlus className="size-3.5" /> {form.imageUrl ? "Replace" : "Upload or choose"}
                  </Button>
                  {form.imageUrl ? (
                    <Button type="button" size="sm" variant="ghost" aria-label="Remove picture" onClick={() => set("imageUrl", null)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">Drawn over the gradient. Pick a dark picture or keep the text colour light so the words stay readable.</p>
          </div>
          {canEdit ? (
            <div className="flex gap-2">
              <Button onClick={() => save.mutate(form)} loading={save.isPending}>
                Save
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Only platform admins and owners can change this.</p>
          )}
        </Card>
        <div className="flex flex-col gap-2">
          <Label>Preview</Label>
          <div className={`flex min-h-72 flex-col gap-3 rounded-xl p-8 ${form.verticalAlign === "top" ? "justify-start" : form.verticalAlign === "bottom" ? "justify-end" : "justify-center"}`} style={bg}>
            <h2 className="text-2xl font-bold tracking-tight">{form.heading}</h2>
            <p className="max-w-sm text-sm opacity-90">{form.body}</p>
          </div>
        </div>
      </div>
      <MediaPickerDialog
        open={picking}
        onOpenChange={setPicking}
        accept={["image"]}
        multiple={false}
        max={1}
        title="Choose sign-in background"
        onSelect={(items: MediaItem[]) => {
          setPicking(false);
          const url = items[0]?.url;
          if (url) set("imageUrl", url);
        }}
      />
    </PageContainer>
  );
}
