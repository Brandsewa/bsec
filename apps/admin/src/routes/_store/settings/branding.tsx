import { createFileRoute } from "@tanstack/react-router";
import { RotateCcw, Save, Upload } from "lucide-react";
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormSkeleton, PageSkeleton, toast } from "@bs/ui";
import { Button } from "@bs/ui";
import { Input } from "@bs/ui";
import { FieldLabel } from "@bs/ui";
import { HeaderActions, SettingsCard, SettingsPageFrame, useUnsavedGuard } from "../../../components/settings/settings-page.tsx";
import type { BrandSettings } from "@bs/contracts";
import { orpc } from "../../../lib/orpc.ts";
import { MediaField } from "@bs/content-admin/media/media-field.tsx";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const ADMIN_MODES = [
  { mode: "light", title: "Light mode", sidebar: "adminLightSidebar", text: "adminLightText", hover: "adminLightHover", hoverText: "adminLightHoverText", defaultSidebar: "#ffffff", defaultText: "#0f172a" },
  { mode: "dark", title: "Dark mode", sidebar: "adminDarkSidebar", text: "adminDarkText", hover: "adminDarkHover", hoverText: "adminDarkHoverText", defaultSidebar: "#0a0a0a", defaultText: "#fafafa" },
] as const;

const IMAGE_SLOTS = [
  { key: "logoLightMediaId", label: "Logo (light background)", aspect: undefined },
  { key: "logoDarkMediaId", label: "Logo (dark background)", aspect: undefined },
  { key: "faviconMediaId", label: "Favicon", aspect: "1:1" as const },
  { key: "appleTouchIconMediaId", label: "Apple Touch Icon", aspect: "1:1" as const },
  { key: "socialImageMediaId", label: "Social sharing image", aspect: "1.91:1" as const },
] as const;

interface FormState {
  storeName: string;
  logoLightMediaId: string | null;
  logoDarkMediaId: string | null;
  faviconMediaId: string | null;
  appleTouchIconMediaId: string | null;
  socialImageMediaId: string | null;
  logoWidth: number;
  adminLightSidebar: string;
  adminLightText: string;
  adminLightHover: string;
  adminLightHoverText: string;
  adminDarkSidebar: string;
  adminDarkText: string;
  adminDarkHover: string;
  adminDarkHoverText: string;
}

function fromServer(b: BrandSettings, storeName: string): FormState {
  return {
    storeName,
    logoLightMediaId: b.logoLightMediaId ?? null,
    logoDarkMediaId: b.logoDarkMediaId ?? null,
    faviconMediaId: b.faviconMediaId ?? null,
    appleTouchIconMediaId: b.appleTouchIconMediaId ?? null,
    socialImageMediaId: b.socialImageMediaId ?? null,
    logoWidth: b.logoWidth,
    adminLightSidebar: b.adminColors?.light?.sidebar ?? "",
    adminLightText: b.adminColors?.light?.sidebarText ?? "",
    adminLightHover: b.adminColors?.light?.hover ?? "",
    adminLightHoverText: b.adminColors?.light?.hoverText ?? "",
    adminDarkSidebar: b.adminColors?.dark?.sidebar ?? "",
    adminDarkText: b.adminColors?.dark?.sidebarText ?? "",
    adminDarkHover: b.adminColors?.dark?.hover ?? "",
    adminDarkHoverText: b.adminColors?.dark?.hoverText ?? "",
  };
}

function BrandingLoading() {
  return (
    <SettingsPageFrame title="Branding" description="Logos and the admin dashboard colours.">
      <SettingsCard>
        <FormSkeleton fields={6} />
      </SettingsCard>
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

  const failed = brandQuery.isError ? brandQuery : settingsQuery.isError ? settingsQuery : null;
  if (failed) {
    return (
      <SettingsPageFrame title="Branding" description="Logos and colours.">
        <SettingsCard>
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
        </SettingsCard>
      </SettingsPageFrame>
    );
  }
  if (!brandQuery.data || !settingsQuery.data) return <BrandingLoading />;

  return (
    <BrandingEditor
      key={`${brandQuery.data.id}:${brandQuery.data.version}`}
      brand={brandQuery.data}
      storeName={settingsQuery.data.storeName}
    />
  );
}

function BrandingEditor({ brand, storeName }: { brand: BrandSettings; storeName: string }) {
  const queryClient = useQueryClient();
  const baseline = fromServer(brand, storeName);
  const [form, setForm] = useState<FormState>(baseline);
  const nameId = useId();

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const guard = useUnsavedGuard(dirty);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((p) => ({ ...p, [key]: value }));

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.branding.get.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.settings.get.key() }),
    ]);

  const updateBrand = useMutation(orpc.admin.branding.update.mutationOptions());
  const updateSettings = useMutation(orpc.admin.settings.update.mutationOptions());
  const publishBrand = useMutation(orpc.admin.branding.publish.mutationOptions());

  const validate = (): string | null => {
    if (!form.storeName.trim()) return "Store name is required";
    for (const m of ADMIN_MODES) {
      const bg = form[m.sidebar];
      const fg = form[m.text];
      const hv = form[m.hover];
      const hvt = form[m.hoverText];
      if ([bg, fg, hv, hvt].some((v) => v && !HEX6.test(v))) return `Admin ${m.title.toLowerCase()} colours must be 6-digit hex values like #1a2b3c`;
      if (hv && contrast(hv, hvt || fg || m.defaultText) < 3) return `Admin ${m.title.toLowerCase()}: the hover text is too hard to read on the hover colour.`;
      if (contrast(bg || m.defaultSidebar, fg || m.defaultText) < 3) return `Admin ${m.title.toLowerCase()}: the text is too hard to read on that sidebar colour. Pick more contrasting colours.`;
    }
    if (!Number.isInteger(form.logoWidth) || form.logoWidth < 20 || form.logoWidth > 1000) return "Logo width must be between 20 and 1000 px";
    return null;
  };

  const persist = async (): Promise<boolean> => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return false;
    }
    const { storeName: name, adminLightSidebar, adminLightText, adminLightHover, adminLightHoverText, adminDarkSidebar, adminDarkText, adminDarkHover, adminDarkHoverText, ...brandFields } = form;
    const adminColors = {
      light: { sidebar: adminLightSidebar || null, sidebarText: adminLightText || null, hover: adminLightHover || null, hoverText: adminLightHoverText || null },
      dark: { sidebar: adminDarkSidebar || null, sidebarText: adminDarkText || null, hover: adminDarkHover || null, hoverText: adminDarkHoverText || null },
    };
    try {
      if (name.trim() !== baseline.storeName) await updateSettings.mutateAsync({ storeName: name.trim() });
      await updateBrand.mutateAsync({ ...brandFields, adminColors });
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

  const busy = updateBrand.isPending || updateSettings.isPending || publishBrand.isPending;

  return (
    <SettingsPageFrame
      title="Branding & visual identity"
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
          <SettingsCard
            title="Store identity & images"
            description="Logos, favicon & store display name"
          >
            <div className="space-y-4">
              <div className="grid gap-1.5">
                <FieldLabel htmlFor={nameId}>Store name</FieldLabel>
                <Input id={nameId} value={form.storeName} aria-invalid={!form.storeName.trim()} onChange={(e) => set("storeName", e.target.value)} required />
                {form.storeName.trim() ? null : <p className="text-xs text-destructive">Store name is required</p>}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {IMAGE_SLOTS.map((slot) => (
                  <MediaField
                    key={slot.key}
                    value={form[slot.key]}
                    onChange={(id) => set(slot.key, id)}
                    accept={["image"]}
                    label={slot.label}
                    aspect={slot.aspect}
                  />
                ))}
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
          </SettingsCard>

          <SettingsCard
            title="Admin dashboard"
            description="Colours of the sidebar and navigation in your team's dashboard"
          >
            <div className="grid gap-4">
              <p className="text-xs text-muted-foreground">Set separately for light and dark mode. Leave a field empty to keep the default; an empty hover colour is worked out from your sidebar colours.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {ADMIN_MODES.map((m) => (
                  <div key={m.mode} className="grid gap-3 rounded-lg border border-border p-3">
                    <p className="text-xs font-semibold text-foreground">{m.title}</p>
                    {([
                      { key: m.sidebar, label: "Sidebar colour", fallback: m.defaultSidebar },
                      { key: m.text, label: "Sidebar text colour", fallback: m.defaultText },
                      { key: m.hover, label: "Hover colour", fallback: m.defaultSidebar },
                      { key: m.hoverText, label: "Hover text colour", fallback: m.defaultText },
                    ] as const).map((f) => {
                      const value = form[f.key];
                      const valid = value === "" || HEX6.test(value);
                      return (
                        <div key={f.key} className="grid gap-1.5">
                          <FieldLabel htmlFor={f.key}>{f.label}</FieldLabel>
                          <div className="flex items-center gap-2">
                            <input
                              id={f.key}
                              type="color"
                              value={HEX6.test(value) ? value : f.fallback}
                              onChange={(e) => set(f.key, e.target.value)}
                              className="size-8 cursor-pointer rounded-md border border-border p-0.5 bg-background shrink-0"
                            />
                            <Input aria-label={`${m.title} ${f.label} hex value`} value={value} placeholder={`Default ${f.fallback}`} aria-invalid={!valid} onChange={(e) => set(f.key, e.target.value)} className="font-mono h-8 text-xs" />
                            {value ? (
                              <Button type="button" variant="ghost" size="sm" onClick={() => set(f.key, "")}>
                                Reset
                              </Button>
                            ) : null}
                          </div>
                          {valid ? null : <p className="text-xs text-destructive">Use a hex colour like #1a2b3c</p>}
                        </div>
                      );
                    })}
                    <div className="grid gap-1 rounded-md p-1.5 text-xs" style={{ background: HEX6.test(form[m.sidebar]) ? form[m.sidebar] : m.defaultSidebar, color: HEX6.test(form[m.text]) ? form[m.text] : m.defaultText }}>
                      <div className="rounded px-2 py-1.5">Orders</div>
                      <div
                        className="rounded px-2 py-1.5"
                        style={{
                          background: HEX6.test(form[m.hover]) ? form[m.hover] : `color-mix(in srgb, ${HEX6.test(form[m.text]) ? form[m.text] : m.defaultText} 14%, ${HEX6.test(form[m.sidebar]) ? form[m.sidebar] : m.defaultSidebar})`,
                          color: HEX6.test(form[m.hoverText]) ? form[m.hoverText] : HEX6.test(form[m.text]) ? form[m.text] : m.defaultText,
                        }}
                      >
                        Products (hovered or current)
                      </div>
                      <div className="rounded px-2 py-1.5">Settings</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SettingsCard>
    </SettingsPageFrame>
  );
}
