import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { MediaPickerDialog } from "@bs/content-admin/media/media-picker-dialog.tsx";
import type { MediaItem } from "@bs/contracts";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";
import { useHasRole } from "../lib/user-context.tsx";
import { contrastRatio } from "../lib/contrast.ts";

type Asset = { url: string; width?: number | null | undefined; height?: number | null | undefined; alt?: string | undefined } | null;
interface Tokens {
  logo: { dark: { full: Asset; icon: Asset }; light: { full: Asset; icon: Asset } };
  favicon: Asset;
  color: { primary: string; secondary: string };
  button: { dark: { background: string; text: string }; light: { background: string; text: string } };
}


const HEX = /^#[0-9a-f]{6}$/i;

function ColourField({ id, label, value, fallback, onChange }: { id: string; label: string; value: string; fallback: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={HEX.test(value) ? value : fallback}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
        />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" maxLength={7} />
      </div>
      {!HEX.test(value) ? <p className="text-xs text-destructive">Use a hex colour such as #1f6f4a.</p> : null}
    </div>
  );
}

function Contrast({ fg, bg }: { fg: string; bg: string }) {
  if (!HEX.test(fg) || !HEX.test(bg)) return null;
  const ratio = contrastRatio(fg, bg);
  const ok = ratio >= 4.5;
  return <Badge variant={ok ? "secondary" : "destructive"}>{ratio.toFixed(1)}:1 {ok ? "AA pass" : "AA fail"}</Badge>;
}

function AssetTile({ label, surface, value, onPick, onClear, disabled }: { label: string; surface: "dark" | "light" | "neutral"; value: Asset; onPick: () => void; onClear: () => void; disabled: boolean }) {
  const bg = surface === "dark" ? "bg-neutral-900" : surface === "light" ? "bg-white" : "bg-muted";
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className={`flex h-24 items-center justify-center rounded-lg border border-border ${bg}`}>
        {value ? <img src={value.url} alt={value.alt || label} className="max-h-16 max-w-[80%] object-contain" /> : <span className="text-xs text-muted-foreground">Not set</span>}
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onPick} disabled={disabled} className="gap-1.5">
          <ImagePlus className="size-3.5" /> {value ? "Replace" : "Choose"}
        </Button>
        {value ? (
          <Button type="button" size="sm" variant="ghost" onClick={onClear} disabled={disabled} aria-label={`Remove ${label}`}>
            <Trash2 className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function Branding() {
  const canEdit = useHasRole("platform_admin");
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["platform", "branding"], queryFn: () => client.branding.get() });
  const [draft, setDraft] = useState<Tokens | null>(null);
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState<string | null>(null);

  // The draft is null until the first edit; until then the page shows the saved tokens.
  const dirty = useMemo(() => Boolean(data && draft && JSON.stringify(data.tokens) !== JSON.stringify(draft)), [data, draft]);
  if (isLoading || !data) return <PageSkeleton />;
  const current = (draft ?? data.tokens) as Tokens;

  const allHex = [current.color.primary, current.color.secondary, current.button.dark.background, current.button.dark.text, current.button.light.background, current.button.light.text].every((c) => HEX.test(c));
  const buttonsReadable = (["dark", "light"] as const).every((t) => contrastRatio(current.button[t].text, current.button[t].background) >= 4.5);
  const valid = allHex && buttonsReadable;

  const update = (fn: (t: Tokens) => void) => {
    const next = structuredClone(current);
    fn(next);
    setDraft(next);
  };

  const onPicked = (items: MediaItem[]) => {
    const item = items[0];
    const key = target;
    setTarget(null);
    if (!item?.url || !key) return;
    const asset: Asset = { url: item.url, width: item.width ?? null, height: item.height ?? null, alt: item.alt ?? "" };
    update((t) => {
      if (key === "favicon") t.favicon = asset;
      else {
        const [, theme, kind] = key.split(".") as ["logo", "dark" | "light", "full" | "icon"];
        t.logo[theme][kind] = asset;
      }
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await client.branding.update(current);
      toast.success("Branding saved");
      await qc.invalidateQueries({ queryKey: ["platform", "branding"] });
      setDraft(null);
    } catch (err) {
      toast.error(messageOf(err, "Could not save branding"));
    } finally {
      setSaving(false);
    }
  };

  const tile = (key: string, label: string, surface: "dark" | "light" | "neutral", value: Asset) => (
    <AssetTile
      label={label}
      surface={surface}
      value={value}
      disabled={!canEdit}
      onPick={() => setTarget(key)}
      onClear={() =>
        update((t) => {
          if (key === "favicon") t.favicon = null;
          else {
            const [, theme, kind] = key.split(".") as ["logo", "dark" | "light", "full" | "icon"];
            t.logo[theme][kind] = null;
          }
        })
      }
    />
  );

  return (
    <PageContainer>
      <PageHeader
        title="Branding"
        description="The platform's own identity. Used across the website, dashboards, sign-in pages and platform emails."
        aside={
          canEdit ? (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setDraft(structuredClone(data.defaults) as Tokens)}>
                <RotateCcw className="size-3.5" /> Reset to defaults
              </Button>
              <Button variant="outline" size="sm" disabled={!dirty} onClick={() => setDraft(null)}>
                Discard
              </Button>
              <Button size="sm" disabled={!dirty || !valid || saving} onClick={save}>
                {saving ? "Saving..." : "Save branding"}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Logo</CardTitle>
            <CardDescription>Dark is shown on dark surfaces, Light on light surfaces. If only one is set it is used for both.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid gap-4 sm:grid-cols-2">
              {tile("logo.dark.full", "Dark · Logo", "dark", current.logo.dark.full)}
              {tile("logo.dark.icon", "Dark · Icon", "dark", current.logo.dark.icon)}
              {tile("logo.light.full", "Light · Logo", "light", current.logo.light.full)}
              {tile("logo.light.icon", "Light · Icon", "light", current.logo.light.icon)}
            </div>
            <div className="max-w-xs">{tile("favicon", "Favicon", "neutral", current.favicon)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Colour</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <ColourField fallback={data.defaults.color.primary} id="brand-primary" label="Primary" value={current.color.primary} onChange={(v) => update((t) => void (t.color.primary = v))} />
            <ColourField fallback={data.defaults.color.primary} id="brand-secondary" label="Secondary" value={current.color.secondary} onChange={(v) => update((t) => void (t.color.secondary = v))} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Button</CardTitle>
            <CardDescription>Text must reach 4.5:1 contrast against its background to be saved.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            {(["dark", "light"] as const).map((theme) => (
              <div key={theme} className="grid gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize">{theme} surface</span>
                  <Contrast fg={current.button[theme].text} bg={current.button[theme].background} />
                </div>
                <ColourField fallback={data.defaults.color.primary} id={`btn-${theme}-bg`} label="Background" value={current.button[theme].background} onChange={(v) => update((t) => void (t.button[theme].background = v))} />
                <ColourField fallback={data.defaults.color.primary} id={`btn-${theme}-fg`} label="Text" value={current.button[theme].text} onChange={(v) => update((t) => void (t.button[theme].text = v))} />
                <div className={`flex h-20 items-center justify-center rounded-lg border border-border ${theme === "dark" ? "bg-neutral-900" : "bg-white"}`}>
                  <span
                    className="rounded-md px-4 py-2 text-sm font-medium"
                    style={{ background: HEX.test(current.button[theme].background) ? current.button[theme].background : undefined, color: HEX.test(current.button[theme].text) ? current.button[theme].text : undefined }}
                  >
                    Button
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        {data.updatedAt ? (
          <p className="text-xs text-muted-foreground">
            Version {data.version} · saved {new Date(data.updatedAt).toLocaleString()} {data.updatedByEmail ? `by ${data.updatedByEmail}` : ""}
          </p>
        ) : null}
      </div>

      <MediaPickerDialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)} accept={["image"]} multiple={false} max={1} onSelect={onPicked} title="Choose brand image" />
    </PageContainer>
  );
}
