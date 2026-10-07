import { createFileRoute } from "@tanstack/react-router";
import { Check, Eye, Laptop, Palette, RotateCcw, Save, Smartphone, Sparkles, Upload } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  DetailSkeleton,
  FormSkeleton,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  toast,
} from "@bs/ui";
import { orpc } from "../../../lib/orpc.ts";

type Radius = "none" | "sm" | "md" | "lg" | "full";
type ButtonStyle = "solid" | "outline" | "soft";

interface ThemeTokens {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontFamily: string;
  borderRadius: Radius;
  buttonStyle: ButtonStyle;
}

type ColorKey = "primaryColor" | "secondaryColor" | "backgroundColor" | "textColor" | "accentColor";

/** Fallback token values used only for keys the stored theme has not set yet. */
const defaultTokens: ThemeTokens = {
  primaryColor: "#4f46e5",
  secondaryColor: "#06b6d4",
  backgroundColor: "#ffffff",
  textColor: "#0f172a",
  accentColor: "#f59e0b",
  fontFamily: "Inter",
  borderRadius: "md",
  buttonStyle: "solid",
};

const fontOptions = [
  { id: "Inter", name: "Inter (Sans-serif)", devanagari: false },
  { id: "Plus Jakarta Sans", name: "Plus Jakarta Sans (Sans-serif)", devanagari: false },
  { id: "DM Sans", name: "DM Sans (Sans-serif)", devanagari: false },
  { id: "Poppins", name: "Poppins (Geometric Sans)", devanagari: true },
  { id: "Mukta", name: "Mukta (Humanist Sans)", devanagari: true },
  { id: "Rozha One", name: "Rozha One (Display Serif)", devanagari: true },
];

const colorPresets = [
  { name: "Indigo", primary: "#4f46e5", secondary: "#06b6d4", accent: "#f59e0b" },
  { name: "Emerald", primary: "#059669", secondary: "#10b981", accent: "#f97316" },
  { name: "Violet", primary: "#7c3aed", secondary: "#a855f7", accent: "#ec4899" },
  { name: "Rose", primary: "#e11d48", secondary: "#f43f5e", accent: "#fbbf24" },
  { name: "Slate", primary: "#0f172a", secondary: "#475569", accent: "#38bdf8" },
];

const radii: Radius[] = ["none", "sm", "md", "lg", "full"];
const buttonStyles: ButtonStyle[] = ["solid", "outline", "soft"];
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const colorFields: { key: ColorKey; label: string }[] = [
  { key: "primaryColor", label: "Primary Brand Color" },
  { key: "secondaryColor", label: "Secondary Color" },
  { key: "accentColor", label: "Accent Color" },
  { key: "backgroundColor", label: "Storefront Background" },
  { key: "textColor", label: "Text Color" },
];

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v ? v : fallback;
}

function tokensFromRecord(record: Record<string, unknown>): ThemeTokens {
  const radius = record.borderRadius;
  const style = record.buttonStyle;
  return {
    primaryColor: str(record.primaryColor, defaultTokens.primaryColor),
    secondaryColor: str(record.secondaryColor, defaultTokens.secondaryColor),
    backgroundColor: str(record.backgroundColor, defaultTokens.backgroundColor),
    textColor: str(record.textColor, defaultTokens.textColor),
    accentColor: str(record.accentColor, defaultTokens.accentColor),
    fontFamily: str(record.fontFamily, defaultTokens.fontFamily),
    borderRadius: radii.includes(radius as Radius) ? (radius as Radius) : defaultTokens.borderRadius,
    buttonStyle: buttonStyles.includes(style as ButtonStyle) ? (style as ButtonStyle) : defaultTokens.buttonStyle,
  };
}

function ThemeLoading() {
  return (
    <PageSkeleton size="full">
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <FormSkeleton fields={6} />
        </div>
        <div className="lg:col-span-7">
          <DetailSkeleton />
        </div>
      </div>
    </PageSkeleton>
  );
}

export const Route = createFileRoute("/_store/online-store/theme")({
  pendingComponent: () => <ThemeLoading />,
  component: ThemePage,
});

function QueryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm font-medium text-foreground">Could not load the theme</p>
      <p className="text-sm text-foreground-2">{message}</p>
      <Button size="sm" onClick={onRetry}>
        <RotateCcw className="size-3.5" aria-hidden />
        Retry
      </Button>
    </div>
  );
}

export function ThemePage() {
  const themeQuery = useQuery(orpc.admin.themes.get.queryOptions());
  const settingsQuery = useQuery(orpc.admin.settings.get.queryOptions());

  if (themeQuery.isError) {
    return (
      <PageContainer size="full">
        <PageBreadcrumbs items={[{ label: "Online Store", href: "/online-store/theme" }, { label: "Themes" }]} />
        <QueryError message={themeQuery.error.message} onRetry={() => void themeQuery.refetch()} />
      </PageContainer>
    );
  }
  if (!themeQuery.data) return <ThemeLoading />;

  return (
    <ThemeEditor
      key={themeQuery.data.id}
      themeName={themeQuery.data.name}
      isActive={themeQuery.data.isActive}
      serverTokens={themeQuery.data.tokens}
      storeName={settingsQuery.data?.storeName ?? ""}
    />
  );
}

function ThemeEditor({
  themeName,
  isActive,
  serverTokens,
  storeName,
}: {
  themeName: string;
  isActive: boolean;
  serverTokens: Record<string, unknown>;
  storeName: string;
}) {
  const queryClient = useQueryClient();
  const saved = tokensFromRecord(serverTokens);
  const [tokens, setTokens] = useState<ThemeTokens>(saved);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");

  const dirty = JSON.stringify(tokens) !== JSON.stringify(saved);
  const invalidColors = colorFields.filter((f) => !HEX.test(tokens[f.key]));

  const publish = useMutation(
    orpc.admin.themes.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.admin.themes.get.key() });
        toast.success("Theme published to the storefront.");
      },
      onError: (err: Error) => toast.error(`Could not publish theme: ${err.message}`),
    }),
  );

  const setColor = (key: ColorKey, value: string) => setTokens((prev) => ({ ...prev, [key]: value }));

  const handlePublish = () => {
    if (invalidColors.length > 0) {
      toast.error(`Enter valid hex colours (e.g. #1a2b3c) for: ${invalidColors.map((f) => f.label).join(", ")}`);
      return;
    }
    publish.mutate({ tokens: { ...tokens } });
  };

  const radiusClass = {
    none: "rounded-none",
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    full: "rounded-full",
  }[tokens.borderRadius];

  const previewName = storeName || "Your store";

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Online Store", href: "/online-store/theme" }, { label: "Themes" }]}
        actions={
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                dirty
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              <span className={`size-1.5 rounded-full ${dirty ? "bg-amber-500" : "bg-emerald-500"}`} />
              {dirty ? "Unpublished changes" : isActive ? "Published (Live)" : "Saved"}
            </span>
            <Button
              size="sm"
              disabled={!dirty || publish.isPending}
              onClick={() => {
                setTokens(saved);
                toast.info("Unsaved theme changes discarded.");
              }}
            >
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
              Discard changes
            </Button>
            <Button
              size="sm"
              disabled={publish.isPending}
              onClick={() => {
                setTokens(defaultTokens);
                toast.info("Default values loaded. Publish to apply them.");
              }}
            >
              <Save className="mr-1.5 size-3.5" aria-hidden />
              Restore defaults
            </Button>
            <Button variant="primary" size="sm" loading={publish.isPending} disabled={!dirty} onClick={handlePublish}>
              <Upload className="mr-1.5 size-3.5" aria-hidden />
              {publish.isPending ? "Publishing..." : "Publish theme"}
            </Button>
          </div>
        }
      />

      <PageHeader
        title="Theme Customizer"
        description={`Colours, typography, corner radius and button style for ${themeName}. The theme service has no separate draft state, so changes go live when you publish.`}
      />

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-5">
          <PageSection title="Colors & Palette">
            <div className="space-y-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-faint-foreground">Quick Presets</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {colorPresets.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() =>
                        setTokens((prev) => ({
                          ...prev,
                          primaryColor: preset.primary,
                          secondaryColor: preset.secondary,
                          accentColor: preset.accent,
                        }))
                      }
                      className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                    >
                      <span className="size-3 rounded-full" style={{ backgroundColor: preset.primary }} />
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {colorFields.map((f) => {
                  const value = tokens[f.key];
                  const valid = HEX.test(value);
                  return (
                    <div key={f.key}>
                      <label htmlFor={f.key} className="text-xs font-medium text-foreground">
                        {f.label}
                      </label>
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          id={f.key}
                          type="color"
                          value={valid && value.length === 7 ? value : "#000000"}
                          onChange={(e) => setColor(f.key, e.target.value)}
                          className="size-8 cursor-pointer rounded border border-border"
                        />
                        <input
                          type="text"
                          aria-label={`${f.label} hex value`}
                          aria-invalid={!valid}
                          value={value}
                          onChange={(e) => setColor(f.key, e.target.value)}
                          className={`h-8 flex-1 rounded border bg-muted/30 px-2 font-mono text-xs ${
                            valid ? "border-border" : "border-destructive"
                          }`}
                        />
                      </div>
                      {valid ? null : <p className="mt-1 text-xs text-destructive">Use a hex colour like #1a2b3c</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </PageSection>

          <PageSection title="Typography (Curated Fonts)">
            <div className="space-y-3">
              <span className="text-xs font-medium text-foreground">Font Family</span>
              <div className="grid gap-2">
                {fontOptions.map((font) => (
                  <button
                    key={font.id}
                    type="button"
                    onClick={() => setTokens((prev) => ({ ...prev, fontFamily: font.id }))}
                    className={`flex items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                      tokens.fontFamily === font.id
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold" style={{ fontFamily: font.id }}>
                        {font.name}
                      </span>
                      <span className="text-xs text-muted-foreground">The quick brown fox jumps over the lazy dog</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {font.devanagari && (
                        <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
                          Devanagari
                        </span>
                      )}
                      {tokens.fontFamily === font.id && <Check className="size-4 text-primary" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </PageSection>

          <PageSection title="Shape & Button Style">
            <div className="space-y-4">
              <div>
                <span className="text-xs font-medium text-foreground">Corner Radius</span>
                <div className="mt-2 grid grid-cols-5 gap-2">
                  {radii.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setTokens((prev) => ({ ...prev, borderRadius: r }))}
                      className={`flex flex-col items-center gap-1 rounded border p-2 text-xs capitalize ${
                        tokens.borderRadius === r ? "border-primary bg-primary/10 font-bold" : "border-border"
                      }`}
                    >
                      <div
                        className={`size-6 border-2 border-faint-foreground ${
                          r === "none"
                            ? "rounded-none"
                            : r === "sm"
                              ? "rounded-xs"
                              : r === "md"
                                ? "rounded-sm"
                                : r === "lg"
                                  ? "rounded-md"
                                  : "rounded-full"
                        }`}
                      />
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-xs font-medium text-foreground">Button Style</span>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {buttonStyles.map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => setTokens((prev) => ({ ...prev, buttonStyle: style }))}
                      className={`rounded border p-2 text-xs font-medium capitalize ${
                        tokens.buttonStyle === style ? "border-primary bg-primary/10 text-primary" : "border-border"
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </PageSection>
        </div>

        <div className="space-y-4 lg:col-span-7">
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-2">
            <div className="flex items-center gap-2">
              <Eye className="size-4 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">Storefront Live Preview</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPreviewDevice("desktop")}
                className={`rounded p-1 text-xs ${previewDevice === "desktop" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                title="Desktop View"
                aria-label="Desktop view"
              >
                <Laptop className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice("mobile")}
                className={`rounded p-1 text-xs ${previewDevice === "mobile" ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                title="Mobile View"
                aria-label="Mobile view"
              >
                <Smartphone className="size-4" />
              </button>
            </div>
          </div>

          <div
            className={`mx-auto overflow-hidden rounded-xl border border-border shadow-lg transition-all ${
              previewDevice === "mobile" ? "max-w-sm" : "w-full"
            }`}
            style={{ backgroundColor: tokens.backgroundColor, color: tokens.textColor, fontFamily: tokens.fontFamily }}
          >
            <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
              <div className="flex items-center gap-2">
                <div className={`size-6 ${radiusClass}`} style={{ backgroundColor: tokens.primaryColor }} />
                <span className="text-base font-bold tracking-tight">{previewName}</span>
              </div>
              <div className="flex items-center gap-4 text-xs font-medium opacity-80">
                <span>Shop</span>
                <span>Collections</span>
                <span>About</span>
              </div>
            </div>

            <div className="px-6 py-12 text-center">
              <span
                className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium ${radiusClass}`}
                style={{ backgroundColor: `${tokens.accentColor}20`, color: tokens.accentColor }}
              >
                <Sparkles className="size-3" /> Announcement
              </span>
              <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">Headline for {previewName}</h1>
              <p className="mx-auto mt-3 max-w-md text-sm opacity-75">
                Supporting text that describes your latest collection or offer.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <button
                  type="button"
                  className={`px-5 py-2.5 text-xs font-semibold shadow-sm transition-opacity hover:opacity-90 ${radiusClass}`}
                  style={{
                    backgroundColor: tokens.buttonStyle === "outline" ? "transparent" : tokens.primaryColor,
                    color: tokens.buttonStyle === "outline" ? tokens.primaryColor : "#ffffff",
                    border: tokens.buttonStyle === "outline" ? `2px solid ${tokens.primaryColor}` : "none",
                    opacity: tokens.buttonStyle === "soft" ? 0.85 : 1,
                  }}
                >
                  Primary action
                </button>
                <button type="button" className={`border border-border/80 px-4 py-2.5 text-xs font-semibold ${radiusClass}`}>
                  Secondary
                </button>
              </div>
            </div>

            <div className="border-t border-border/40 bg-muted/20 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold">Featured products</h3>
                <span className="text-xs font-medium" style={{ color: tokens.primaryColor }}>
                  See all &rarr;
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {[1, 2].map((n) => (
                  <div key={n} className={`border border-border/60 bg-surface p-4 shadow-xs ${radiusClass}`}>
                    <div className={`flex aspect-4/3 w-full items-center justify-center bg-muted/40 ${radiusClass}`}>
                      <Palette className="size-8 opacity-20" />
                    </div>
                    <div className="mt-3 flex items-start justify-between">
                      <div>
                        <h4 className="text-xs font-semibold">Product name</h4>
                        <p className="mt-0.5 text-xs font-bold text-foreground">₹0.00</p>
                      </div>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: `${tokens.secondaryColor}25`, color: tokens.secondaryColor }}
                      >
                        Label
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`mt-3 w-full py-1.5 text-xs font-medium transition-opacity hover:opacity-90 ${radiusClass}`}
                      style={{ backgroundColor: tokens.primaryColor, color: "#ffffff" }}
                    >
                      Add to cart
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
