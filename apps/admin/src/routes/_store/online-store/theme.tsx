import { createFileRoute } from "@tanstack/react-router";
import { Check, Eye, Laptop, Palette, RotateCcw, Save, Smartphone, Sparkles, Upload } from "lucide-react";
import { useState } from "react";
import {
  Button,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  toast,
} from "@bs/ui";

interface ThemeTokens {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontFamily: string;
  borderRadius: "none" | "sm" | "md" | "lg" | "full";
  buttonStyle: "solid" | "outline" | "soft";
}

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

export const Route = createFileRoute("/_store/online-store/theme")({
  pendingComponent: () => <PageSkeleton />,
  component: ThemePage,
});

function ThemePage() {
  const [tokens, setTokens] = useState<ThemeTokens>(defaultTokens);
  const [isPublished, setIsPublished] = useState(true);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [saving, setSaving] = useState(false);

  const radiusClass = {
    none: "rounded-none",
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    full: "rounded-full",
  }[tokens.borderRadius];

  const handlePublish = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setIsPublished(true);
      toast.success("Theme published successfully to storefront!");
    }, 400);
  };

  const handleSaveDraft = () => {
    setIsPublished(false);
    toast.info("Theme changes saved as draft.");
  };

  const handleReset = () => {
    setTokens(defaultTokens);
    toast.info("Theme tokens reset to defaults.");
  };

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Online Store", href: "/online-store/theme" }, { label: "Themes" }]}
        actions={
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isPublished
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              }`}
            >
              <span className={`size-1.5 rounded-full ${isPublished ? "bg-emerald-500" : "bg-amber-500"}`} />
              {isPublished ? "Published (Live)" : "Unpublished Draft"}
            </span>
            <Button variant="default" size="sm" onClick={handleReset}>
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
              Reset
            </Button>
            <Button variant="default" size="sm" onClick={handleSaveDraft}>
              <Save className="mr-1.5 size-3.5" aria-hidden />
              Save draft
            </Button>
            <Button variant="primary" size="sm" disabled={saving} onClick={handlePublish}>
              <Upload className="mr-1.5 size-3.5" aria-hidden />
              {saving ? "Publishing..." : "Publish Theme"}
            </Button>
          </div>
        }
      />

      <PageHeader
        title="Theme Customizer"
        description="Configure colors, typography tokens, border radii, and button styles for your customer-facing storefront."
      />

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Token Controls Panel */}
        <div className="space-y-6 lg:col-span-5">
          {/* Color Palettes */}
          <PageSection title="Colors & Palette">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  Quick Presets
                </label>
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
                      className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-100"
                    >
                      <span className="size-3 rounded-full" style={{ backgroundColor: preset.primary }} />
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="primaryColor" className="text-xs font-medium text-foreground">
                    Primary Brand Color
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      id="primaryColor"
                      type="color"
                      value={tokens.primaryColor}
                      onChange={(e) => setTokens({ ...tokens, primaryColor: e.target.value })}
                      className="size-8 cursor-pointer rounded border border-border"
                    />
                    <input
                      type="text"
                      value={tokens.primaryColor}
                      onChange={(e) => setTokens({ ...tokens, primaryColor: e.target.value })}
                      className="h-8 flex-1 rounded border border-border bg-surface-50 px-2 font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="secondaryColor" className="text-xs font-medium text-foreground">
                    Secondary Color
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      id="secondaryColor"
                      type="color"
                      value={tokens.secondaryColor}
                      onChange={(e) => setTokens({ ...tokens, secondaryColor: e.target.value })}
                      className="size-8 cursor-pointer rounded border border-border"
                    />
                    <input
                      type="text"
                      value={tokens.secondaryColor}
                      onChange={(e) => setTokens({ ...tokens, secondaryColor: e.target.value })}
                      className="h-8 flex-1 rounded border border-border bg-surface-50 px-2 font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="accentColor" className="text-xs font-medium text-foreground">
                    Accent Color
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      id="accentColor"
                      type="color"
                      value={tokens.accentColor}
                      onChange={(e) => setTokens({ ...tokens, accentColor: e.target.value })}
                      className="size-8 cursor-pointer rounded border border-border"
                    />
                    <input
                      type="text"
                      value={tokens.accentColor}
                      onChange={(e) => setTokens({ ...tokens, accentColor: e.target.value })}
                      className="h-8 flex-1 rounded border border-border bg-surface-50 px-2 font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="backgroundColor" className="text-xs font-medium text-foreground">
                    Storefront Background
                  </label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      id="backgroundColor"
                      type="color"
                      value={tokens.backgroundColor}
                      onChange={(e) => setTokens({ ...tokens, backgroundColor: e.target.value })}
                      className="size-8 cursor-pointer rounded border border-border"
                    />
                    <input
                      type="text"
                      value={tokens.backgroundColor}
                      onChange={(e) => setTokens({ ...tokens, backgroundColor: e.target.value })}
                      className="h-8 flex-1 rounded border border-border bg-surface-50 px-2 font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
          </PageSection>

          {/* Typography */}
          <PageSection title="Typography (Curated Fonts)">
            <div className="space-y-3">
              <label className="text-xs font-medium text-foreground">Font Family</label>
              <div className="grid gap-2">
                {fontOptions.map((font) => (
                  <button
                    key={font.id}
                    type="button"
                    onClick={() => setTokens({ ...tokens, fontFamily: font.id })}
                    className={`flex items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                      tokens.fontFamily === font.id
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border hover:bg-surface-50"
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold" style={{ fontFamily: font.id }}>
                        {font.name}
                      </span>
                      <span className="text-xs text-foreground-lighter">
                        The quick brown fox jumps over the lazy dog
                      </span>
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

          {/* Shape & Buttons */}
          <PageSection title="Shape & Button Style">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-foreground">Corner Radius</label>
                <div className="mt-2 grid grid-cols-5 gap-2">
                  {(["none", "sm", "md", "lg", "full"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setTokens({ ...tokens, borderRadius: r })}
                      className={`flex flex-col items-center gap-1 rounded border p-2 text-xs capitalize ${
                        tokens.borderRadius === r ? "border-primary bg-primary/10 font-bold" : "border-border"
                      }`}
                    >
                      <div
                        className={`size-6 border-2 border-foreground-muted ${
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
                <label className="text-xs font-medium text-foreground">Button Style</label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["solid", "outline", "soft"] as const).map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => setTokens({ ...tokens, buttonStyle: style })}
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

        {/* Live Storefront Preview */}
        <div className="space-y-4 lg:col-span-7">
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-50 p-2">
            <div className="flex items-center gap-2">
              <Eye className="size-4 text-foreground-lighter" />
              <span className="text-xs font-semibold text-foreground">Storefront Live Preview</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPreviewDevice("desktop")}
                className={`rounded p-1 text-xs ${
                  previewDevice === "desktop" ? "bg-surface-200 text-foreground" : "text-foreground-lighter"
                }`}
                title="Desktop View"
              >
                <Laptop className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice("mobile")}
                className={`rounded p-1 text-xs ${
                  previewDevice === "mobile" ? "bg-surface-200 text-foreground" : "text-foreground-lighter"
                }`}
                title="Mobile View"
              >
                <Smartphone className="size-4" />
              </button>
            </div>
          </div>

          <div
            className={`mx-auto overflow-hidden rounded-xl border border-border shadow-lg transition-all ${
              previewDevice === "mobile" ? "max-w-sm" : "w-full"
            }`}
            style={{
              backgroundColor: tokens.backgroundColor,
              color: tokens.textColor,
              fontFamily: tokens.fontFamily,
            }}
          >
            {/* Storefront Nav Bar */}
            <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
              <div className="flex items-center gap-2">
                <div
                  className={`size-6 ${radiusClass}`}
                  style={{ backgroundColor: tokens.primaryColor }}
                />
                <span className="text-base font-bold tracking-tight">Acme Store</span>
              </div>
              <div className="flex items-center gap-4 text-xs font-medium opacity-80">
                <span>Shop</span>
                <span>Collections</span>
                <span>About</span>
              </div>
            </div>

            {/* Hero Section Preview */}
            <div className="px-6 py-12 text-center">
              <span
                className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium ${radiusClass}`}
                style={{
                  backgroundColor: `${tokens.accentColor}20`,
                  color: tokens.accentColor,
                }}
              >
                <Sparkles className="size-3" /> New Collection Live
              </span>
              <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
                Crafted for everyday comfort.
              </h1>
              <p className="mx-auto mt-3 max-w-md text-sm opacity-75">
                Explore our catalog of sustainable home goods and organic essentials.
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
                  Shop Now
                </button>
                <button
                  type="button"
                  className={`border border-border/80 px-4 py-2.5 text-xs font-semibold ${radiusClass}`}
                >
                  View Lookbook
                </button>
              </div>
            </div>

            {/* Featured Product Cards */}
            <div className="border-t border-border/40 bg-surface-50/40 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold">Featured Products</h3>
                <span className="text-xs font-medium" style={{ color: tokens.primaryColor }}>
                  See all &rarr;
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  { title: "Organic Cotton T-Shirt", price: "₹2,999", tag: "Best Seller" },
                  { title: "Ceramic Coffee Mug", price: "₹899", tag: "New" },
                ].map((item) => (
                  <div
                    key={item.title}
                    className={`border border-border/60 bg-surface p-4 shadow-xs ${radiusClass}`}
                  >
                    <div className={`aspect-4/3 w-full bg-surface-200/60 ${radiusClass} flex items-center justify-center`}>
                      <Palette className="size-8 opacity-20" />
                    </div>
                    <div className="mt-3 flex items-start justify-between">
                      <div>
                        <h4 className="text-xs font-semibold">{item.title}</h4>
                        <p className="text-xs font-bold text-foreground mt-0.5">{item.price}</p>
                      </div>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          backgroundColor: `${tokens.secondaryColor}25`,
                          color: tokens.secondaryColor,
                        }}
                      >
                        {item.tag}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`mt-3 w-full py-1.5 text-xs font-medium transition-opacity hover:opacity-90 ${radiusClass}`}
                      style={{
                        backgroundColor: tokens.primaryColor,
                        color: "#ffffff",
                      }}
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
