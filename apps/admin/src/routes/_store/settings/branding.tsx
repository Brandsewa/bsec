import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Image as ImageIcon, RotateCcw, Save, ShieldCheck, Upload } from "lucide-react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Button } from "@bs/ui";
import { Input } from "@bs/ui";
import { FieldLabel } from "@bs/ui";
import { Field } from "../../../components/field.tsx";
import { HeaderActions, SettingsPageFrame, SettingsSection, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import { SimpleSelect } from "../../../components/simple-select.tsx";
import type { BrandSettings } from "@bs/contracts";
import { client, orpc } from "../../../lib/orpc.ts";

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Calculates WCAG 2.1 relative luminance and contrast ratio in client side.
 */
function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "").trim();
  if (clean.length === 3) {
    const c0 = clean.charAt(0);
    const c1 = clean.charAt(1);
    const c2 = clean.charAt(2);
    return [parseInt(c0 + c0, 16), parseInt(c1 + c1, 16), parseInt(c2 + c2, 16)];
  }
  if (clean.length === 6) {
    return [parseInt(clean.substring(0, 2), 16), parseInt(clean.substring(2, 4), 16), parseInt(clean.substring(4, 6), 16)];
  }
  return [0, 0, 0];
}

function getLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function computeContrast(color1: string, color2: string): number {
  if (!HEX.test(color1) || !HEX.test(color2)) return 1;
  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const curatedFonts = [
  { id: "Inter", name: "Inter", category: "Sans-serif", devanagari: false },
  { id: "Plus Jakarta Sans", name: "Plus Jakarta Sans", category: "Sans-serif", devanagari: false },
  { id: "DM Sans", name: "DM Sans", category: "Sans-serif", devanagari: false },
  { id: "Poppins", name: "Poppins", category: "Geometric Sans", devanagari: true },
  { id: "Mukta", name: "Mukta", category: "Humanist Sans", devanagari: true },
  { id: "Rozha One", name: "Rozha One", category: "Display Serif", devanagari: true },
];

const colorFields = [
  { key: "primaryColor", label: "Primary color" },
  { key: "secondaryColor", label: "Secondary color" },
  { key: "accentColor", label: "Accent color" },
  { key: "backgroundColor", label: "Background color" },
  { key: "surfaceColor", label: "Surface color" },
  { key: "textColor", label: "Text color" },
] as const;

type ColorKey = (typeof colorFields)[number]["key"];

const IMAGE_SLOTS = [
  { key: "logoLightMediaId", label: "Logo (light background)" },
  { key: "logoDarkMediaId", label: "Logo (dark background)" },
  { key: "faviconMediaId", label: "Favicon" },
  { key: "socialImageMediaId", label: "Social sharing image" },
] as const;
type SlotKey = (typeof IMAGE_SLOTS)[number]["key"];

interface FormState {
  storeName: string;
  logoLightMediaId: string | null;
  logoDarkMediaId: string | null;
  faviconMediaId: string | null;
  socialImageMediaId: string | null;
  logoWidth: number;
  fontHeading: BrandSettings["fontHeading"];
  fontBody: BrandSettings["fontBody"];
  fontSizeScale: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  colorMode: BrandSettings["colorMode"];
  cornerRadius: BrandSettings["cornerRadius"];
  buttonStyle: BrandSettings["buttonStyle"];
}

function fromServer(b: BrandSettings, storeName: string): FormState {
  return {
    storeName,
    logoLightMediaId: b.logoLightMediaId ?? null,
    logoDarkMediaId: b.logoDarkMediaId ?? null,
    faviconMediaId: b.faviconMediaId ?? null,
    socialImageMediaId: b.socialImageMediaId ?? null,
    logoWidth: b.logoWidth,
    fontHeading: b.fontHeading,
    fontBody: b.fontBody,
    fontSizeScale: b.fontSizeScale,
    primaryColor: b.primaryColor,
    secondaryColor: b.secondaryColor,
    accentColor: b.accentColor,
    backgroundColor: b.backgroundColor,
    surfaceColor: b.surfaceColor,
    textColor: b.textColor,
    colorMode: b.colorMode,
    cornerRadius: b.cornerRadius,
    buttonStyle: b.buttonStyle,
  };
}

function BrandingLoading() {
  return (
    <SettingsPageFrame title="Branding" description="Logos, colours and typography." width="wide">
      <SettingsSection>
        <FormSkeleton fields={6} />
      </SettingsSection>
    </SettingsPageFrame>
  );
}

export const Route = createFileRoute("/_store/settings/branding")({
  pendingComponent: () => <PageSkeleton />,
  component: BrandingSettingsPage,
});

export function BrandingSettingsPage() {
  const brandQuery = useQuery(orpc.admin.branding.get.queryOptions());
  const settingsQuery = useQuery(orpc.admin.settings.get.queryOptions());
  const mediaQuery = useQuery(orpc.admin.media.list.queryOptions({ input: { limit: 100, offset: 0 } }));

  const failed = brandQuery.isError ? brandQuery : settingsQuery.isError ? settingsQuery : null;
  if (failed) {
    return (
      <SettingsPageFrame title="Branding" description="Logos, colours and typography." width="wide">
        <SettingsSection>
          <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-xs font-medium text-foreground">Could not load branding settings</p>
            <p className="text-xs text-muted-foreground">{failed.error?.message}</p>
            <Button
              size="sm"
              onClick={() => {
                void brandQuery.refetch();
                void settingsQuery.refetch();
              }}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Retry
            </Button>
          </div>
        </SettingsSection>
      </SettingsPageFrame>
    );
  }
  if (!brandQuery.data || !settingsQuery.data) return <BrandingLoading />;

  return (
    <BrandingEditor
      key={`${brandQuery.data.id}:${brandQuery.data.version}`}
      brand={brandQuery.data}
      storeName={settingsQuery.data.storeName}
      media={mediaQuery.data?.items ?? []}
    />
  );
}

type MediaEntry = { id: string; url?: string | undefined; alt?: string | null | undefined };

function BrandingEditor({ brand, storeName, media }: { brand: BrandSettings; storeName: string; media: MediaEntry[] }) {
  const queryClient = useQueryClient();
  const baseline = fromServer(brand, storeName);
  const [form, setForm] = useState<FormState>(baseline);
  const [uploading, setUploading] = useState<SlotKey | null>(null);
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const nameId = useId();

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const guard = useUnsavedGuard(dirty);
  const invalidColors = colorFields.filter((f) => !HEX.test(form[f.key]));
  const textBg = computeContrast(form.textColor, form.backgroundColor);
  const primaryBg = computeContrast(form.primaryColor, form.backgroundColor);
  const textPass = textBg >= 4.5;
  const primaryPass = primaryBg >= 4.5;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((p) => ({ ...p, [key]: value }));

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.branding.get.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.settings.get.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.media.list.key() }),
    ]);

  const updateBrand = useMutation(orpc.admin.branding.update.mutationOptions());
  const updateSettings = useMutation(orpc.admin.settings.update.mutationOptions());
  const publishBrand = useMutation(orpc.admin.branding.publish.mutationOptions());

  const validate = (): string | null => {
    if (!form.storeName.trim()) return "Store name is required";
    if (invalidColors.length > 0) return `Enter valid hex colours for: ${invalidColors.map((f) => f.label).join(", ")}`;
    if (!Number.isInteger(form.logoWidth) || form.logoWidth < 20 || form.logoWidth > 1000) return "Logo width must be between 20 and 1000 px";
    return null;
  };

  const persist = async (): Promise<boolean> => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return false;
    }
    const { storeName: name, ...brandFields } = form;
    try {
      if (name.trim() !== baseline.storeName) await updateSettings.mutateAsync({ storeName: name.trim() });
      await updateBrand.mutateAsync(brandFields);
      return true;
    } catch (err) {
      toast.error(`Could not save branding: ${err instanceof Error ? err.message : "unknown error"}`);
      return false;
    }
  };

  const handleSave = async () => {
    if (await persist()) {
      await invalidateAll();
      toast.success("Branding saved.");
    }
  };

  const handlePublish = async () => {
    if (dirty && !(await persist())) return;
    try {
      const res = await publishBrand.mutateAsync(undefined);
      await invalidateAll();
      toast.success(`Branding published (version ${res.version}).`);
    } catch (err) {
      toast.error(`Could not publish branding: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  };

  const handleUpload = async (slot: SlotKey, file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file.");
      return;
    }
    setUploading(slot);
    try {
      const presigned = await client.admin.media.requestUpload({
        filename: file.name,
        mime: file.type,
        bytes: file.size,
        folder: "branding",
      });
      const put = await fetch(presigned.uploadUrl, { method: "PUT", headers: presigned.headers, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      const created = await client.admin.media.create({
        storageKey: presigned.storageKey,
        mime: file.type,
        bytes: file.size,
        alt: file.name,
        folder: "branding",
      });
      setLocalUrls((prev) => ({ ...prev, [created.id]: created.url ?? URL.createObjectURL(file) }));
      set(slot, created.id);
      await queryClient.invalidateQueries({ queryKey: orpc.admin.media.list.key() });
      toast.success("Image uploaded. Save to apply it.");
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setUploading(null);
    }
  };

  const urlFor = (id: string | null): string | undefined => {
    if (!id) return undefined;
    return localUrls[id] ?? media.find((m) => m.id === id)?.url;
  };

  const fixTextColor = () => {
    const fixed = getLuminance(form.backgroundColor) > 0.5 ? "#0f172a" : "#ffffff";
    set("textColor", fixed);
    toast.success(`Text colour set to ${fixed} for better contrast.`);
  };

  const busy = updateBrand.isPending || updateSettings.isPending || publishBrand.isPending;
  const previewFont = form.fontBody;

  return (
    <SettingsPageFrame
      title="Branding & visual identity"
      width="wide"
      description={`Logos, colours and typography. Published version ${brand.version}${brand.publishedAt ? `, last published ${new Date(brand.publishedAt).toLocaleDateString()}` : ", not published yet"}.`}
    >
      {guard}
      <HeaderActions>
        <Button variant="outline" disabled={!dirty || busy} onClick={() => setForm(baseline)}>
          <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
          Discard
        </Button>
        <Button variant="outline" disabled={!dirty || busy} onClick={() => void handleSave()}>
          <Save className="mr-1.5 size-3.5" aria-hidden />
          {updateBrand.isPending || updateSettings.isPending ? "Saving…" : "Save branding"}
        </Button>
        <Button disabled={busy} onClick={() => void handlePublish()}>
          <Upload className="mr-1.5 size-3.5" aria-hidden />
          {publishBrand.isPending ? "Publishing…" : "Publish"}
        </Button>
      </HeaderActions>

      <div className="grid lg:grid-cols-12 lg:divide-x lg:divide-border">
        <div className="lg:col-span-7">
          <SettingsSection title="Store identity & images">
            <div className="space-y-3">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor={nameId}>Store name</FieldLabel>
                <Input id={nameId} value={form.storeName} aria-invalid={!form.storeName.trim()} onChange={(e) => set("storeName", e.target.value)} required />
                {form.storeName.trim() ? null : <p className="text-destructive">Store name is required</p>}
              </div>
              <p className="text-xs text-muted-foreground">A tagline is not stored by the backend yet, so it is not editable here.</p>

              <div className="grid gap-3 sm:grid-cols-2">
                {IMAGE_SLOTS.map((slot) => {
                  const id = form[slot.key];
                  const url = urlFor(id);
                  return (
                    <div key={slot.key} className="space-y-2">
                      <span className="text-xs font-medium text-foreground">{slot.label}</span>
                      <div className="flex h-16 items-center justify-center rounded-lg border border-border bg-white p-2">
                        {url ? (
                          <img src={url} alt={`${slot.label} preview`} className="max-h-12 max-w-full object-contain" />
                        ) : (
                          <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted">
                          <Upload className="size-3.5" aria-hidden />
                          {uploading === slot.key ? "Uploading..." : id ? "Replace" : "Upload"}
                          <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            disabled={uploading !== null}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (file) void handleUpload(slot.key, file);
                            }}
                          />
                        </label>
                        {id ? (
                          <Button size="sm" variant="ghost" onClick={() => set(slot.key, null)}>
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-1.5">
                <FieldLabel htmlFor="logo-width">Logo width (px)</FieldLabel>
                <Input
                  id="logo-width"
                  type="number"
                  min={20}
                  max={1000}
                  value={form.logoWidth}
                  onChange={(e) => set("logoWidth", Number(e.target.value))}
                />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection title="Brand colours">
            <div className="grid gap-3 sm:grid-cols-2">
              {colorFields.map((f) => {
                const value = form[f.key as ColorKey];
                const valid = HEX.test(value);
                return (
                  <div key={f.key} className="grid gap-1.5">
                    <FieldLabel htmlFor={f.key}>{f.label}</FieldLabel>
                    <div className="flex items-center gap-2">
                      <input
                        id={f.key}
                        type="color"
                        value={valid && value.length === 7 ? value : "#000000"}
                        onChange={(e) => set(f.key, e.target.value)}
                        className="size-7 cursor-pointer rounded border border-border"
                      />
                      <Input aria-label={`${f.label} hex value`} value={value} aria-invalid={!valid} onChange={(e) => set(f.key, e.target.value)} className="font-mono" />
                    </div>
                    {valid ? null : <p className="text-xs text-destructive">Use a hex colour like #1a2b3c</p>}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Field id="color-mode" label="Colour mode">
                <SimpleSelect
                  id="color-mode"
                  className="w-44"
                  value={form.colorMode}
                  onChange={(v) => set("colorMode", v as FormState["colorMode"])}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                    { value: "auto", label: "Match visitor device" },
                  ]}
                />
              </Field>
              <Field id="corner-radius" label="Corner radius">
                <SimpleSelect
                  id="corner-radius"
                  className="w-32"
                  value={form.cornerRadius}
                  onChange={(v) => set("cornerRadius", v as FormState["cornerRadius"])}
                  options={(["none", "small", "medium", "large", "full"] as const).map((r) => ({ value: r, label: r }))}
                />
              </Field>
              <Field id="button-style" label="Button style">
                <SimpleSelect
                  id="button-style"
                  className="w-32"
                  value={form.buttonStyle}
                  onChange={(v) => set("buttonStyle", v as FormState["buttonStyle"])}
                  options={(["solid", "outline", "pill"] as const).map((r) => ({ value: r, label: r }))}
                />
              </Field>
            </div>
          </SettingsSection>

          <SettingsSection title="Typography">
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  { key: "fontHeading", label: "Heading font" },
                  { key: "fontBody", label: "Body font" },
                ] as const
              ).map((f) => (
                <Field key={f.key} id={f.key} label={f.label}>
                  <SimpleSelect
                    id={f.key}
                    value={form[f.key]}
                    onChange={(v) => set(f.key, v as BrandSettings[typeof f.key])}
                    options={[
                      ...(curatedFonts.some((c) => c.id === form[f.key]) ? [] : [{ value: form[f.key], label: form[f.key] }]),
                      ...curatedFonts.map((c) => ({ value: c.id, label: `${c.name} (${c.category})${c.devanagari ? " - Devanagari" : ""}` })),
                    ]}
                  />
                </Field>
              ))}
              <Field id="font-scale" label="Text size">
                <SimpleSelect
                  id="font-scale"
                  value={form.fontSizeScale}
                  onChange={(v) => set("fontSizeScale", v)}
                  options={[
                    ...(["small", "default", "large"].includes(form.fontSizeScale) ? [] : [{ value: form.fontSizeScale, label: form.fontSizeScale }]),
                    { value: "small", label: "Small" },
                    { value: "default", label: "Default" },
                    { value: "large", label: "Large" },
                  ]}
                />
              </Field>
            </div>
          </SettingsSection>
        </div>

        <div className="border-t border-border lg:col-span-5 lg:border-t-0">
          <SettingsSection title="Accessibility check" description="Computed from the colours above (WCAG AA needs 4.5:1).">
            <div className="space-y-3">
              {(
                [
                  { label: "Text on background", ratio: textBg, pass: textPass },
                  { label: "Primary on background", ratio: primaryBg, pass: primaryPass },
                ] as const
              ).map((row) => (
                <div key={row.label} className="flex items-center justify-between rounded-md border border-border p-3 text-xs">
                  <span className="flex items-center gap-2">
                    {row.pass ? <CheckCircle2 className="size-4 text-emerald-500" aria-hidden /> : <AlertTriangle className="size-4 text-amber-500" aria-hidden />}
                    {row.label}
                  </span>
                  <span className="font-mono">{`${row.ratio.toFixed(2)}:1`}</span>
                </div>
              ))}
              {textPass ? null : (
                <Button size="sm" variant="outline" onClick={fixTextColor}>
                  <ShieldCheck className="mr-1.5 size-3.5" aria-hidden />
                  Fix text colour
                </Button>
              )}
            </div>
          </SettingsSection>

          <SettingsSection title="Preview">
            <div
              className="overflow-hidden rounded-lg border border-border"
              style={{ backgroundColor: form.backgroundColor, color: form.textColor, fontFamily: previewFont }}
            >
              <div className="p-5" style={{ backgroundColor: form.surfaceColor }}>
                <p className="text-lg font-bold" style={{ fontFamily: form.fontHeading }}>
                  {form.storeName || "Your store"}
                </p>
              </div>
              <div className="space-y-3 p-5">
                <p className="text-sm">Body text sample in your selected body font.</p>
                <button
                  type="button"
                  className="px-4 py-2 text-sm font-semibold"
                  style={{
                    backgroundColor: form.buttonStyle === "outline" ? "transparent" : form.primaryColor,
                    color: form.buttonStyle === "outline" ? form.primaryColor : "#ffffff",
                    border: `2px solid ${form.primaryColor}`,
                    borderRadius: form.buttonStyle === "pill" || form.cornerRadius === "full" ? 9999 : { none: 0, small: 4, medium: 8, large: 14, full: 9999 }[form.cornerRadius],
                  }}
                >
                  Button
                </button>
                <span className="ml-3 text-sm font-medium" style={{ color: form.accentColor }}>
                  Accent link
                </span>
              </div>
            </div>
          </SettingsSection>
        </div>
      </div>
    </SettingsPageFrame>
  );
}
