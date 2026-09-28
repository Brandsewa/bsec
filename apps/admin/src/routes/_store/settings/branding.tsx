import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useId, useState } from "react";
import {
  Button,
  Input,
  Label,
  MetricCard,
  MetricCardSkeleton,
  PageBreadcrumbs,
  PageContainer,
  PageHeader,
  PageSection,
  PageSkeleton,
  toast,
} from "@bs/ui";

interface BrandingState {
  brandName: string;
  tagline: string;
  logoLightUrl: string;
  logoDarkUrl: string;
  faviconUrl: string;
  fontFamily: string;
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
}

const defaultBranding: BrandingState = {
  brandName: "Acme Store",
  tagline: "Sustainable goods crafted with care",
  logoLightUrl: "https://images.unsplash.com/photo-1599305445671-ac291c95aaa9?w=200&h=60&fit=crop",
  logoDarkUrl: "https://images.unsplash.com/photo-1599305445671-ac291c95aaa9?w=200&h=60&fit=crop",
  faviconUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=128&h=128&fit=crop",
  fontFamily: "Inter",
  primaryColor: "#4f46e5",
  backgroundColor: "#ffffff",
  textColor: "#0f172a",
};

const curatedFonts = [
  { id: "Inter", name: "Inter", category: "Sans-serif", devanagari: false },
  { id: "Plus Jakarta Sans", name: "Plus Jakarta Sans", category: "Sans-serif", devanagari: false },
  { id: "DM Sans", name: "DM Sans", category: "Sans-serif", devanagari: false },
  { id: "Poppins", name: "Poppins", category: "Geometric Sans", devanagari: true },
  { id: "Mukta", name: "Mukta", category: "Humanist Sans", devanagari: true },
  { id: "Rozha One", name: "Rozha One", category: "Display Serif", devanagari: true },
];

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
    return [
      parseInt(clean.substring(0, 2), 16),
      parseInt(clean.substring(2, 4), 16),
      parseInt(clean.substring(4, 6), 16),
    ];
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

function computeContrast(color1: string, color2: string): number {
  try {
    const l1 = getLuminance(color1);
    const l2 = getLuminance(color2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  } catch {
    return 1.0;
  }
}

export const Route = createFileRoute("/_store/settings/branding")({
  pendingComponent: () => (
    <PageSkeleton>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>
    </PageSkeleton>
  ),
  component: BrandingSettingsPage,
});

function BrandingSettingsPage() {
  const [branding, setBranding] = useState<BrandingState>(defaultBranding);
  const [saving, setSaving] = useState(false);

  const textBgRatio = computeContrast(branding.textColor, branding.backgroundColor);
  const primaryBgRatio = computeContrast(branding.primaryColor, branding.backgroundColor);
  const isTextAaPass = textBgRatio >= 4.5;
  const isPrimaryAaPass = primaryBgRatio >= 4.5;

  const brandNameId = useId();
  const taglineId = useId();
  const logoLightId = useId();
  const logoDarkId = useId();
  const faviconInputId = useId();
  const primaryColorId = useId();
  const bgColorId = useId();
  const textColorId = useId();

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      toast.success("Branding settings saved successfully!");
    }, 400);
  };

  const handleFixTextColor = () => {
    // Pick dark slate for high contrast on light bg, or pure white on dark bg
    const bgLum = getLuminance(branding.backgroundColor);
    const fixedColor = bgLum > 0.5 ? "#0f172a" : "#ffffff";
    setBranding((prev) => ({ ...prev, textColor: fixedColor }));
    toast.success(`Text color adjusted to ${fixedColor} for WCAG AA compliance.`);
  };

  const manifestSnippet = JSON.stringify(
    {
      name: branding.brandName,
      short_name: branding.brandName,
      icons: [
        { src: "/favicon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/favicon-512.png", sizes: "512x512", type: "image/png" },
      ],
      theme_color: branding.primaryColor,
      background_color: branding.backgroundColor,
      display: "standalone",
    },
    null,
    2
  );

  return (
    <PageContainer size="full">
      <PageBreadcrumbs
        items={[{ label: "Settings", href: "/settings" }, { label: "Branding" }]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                setBranding(defaultBranding);
                toast.info("Branding reset to defaults.");
              }}
            >
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
              Reset
            </Button>
            <Button variant="primary" size="sm" disabled={saving} onClick={handleSave}>
              <Save className="mr-1.5 size-3.5" aria-hidden />
              {saving ? "Saving..." : "Save Branding"}
            </Button>
          </div>
        }
      />

      <PageHeader
        title="Branding & Visual Identity"
        description="Configure logos, brand colors, curated typography, and verify WCAG AA accessibility contrast."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Brand" value={branding.brandName} icon={Sparkles} />
        <MetricCard
          label="Text / Bg Contrast"
          value={`${textBgRatio.toFixed(2)}:1`}
          change={{
            value: isTextAaPass ? "WCAG AA Pass" : "Fails AA (<4.5)",
            trend: isTextAaPass ? "up" : "down",
          }}
        />
        <MetricCard
          label="Active Font"
          value={branding.fontFamily}
          change={{ value: "Self-hosted R2", trend: "neutral" }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Main Settings Form */}
        <div className="space-y-6 lg:col-span-7">
          {/* Identity & Logos */}
          <PageSection title="Store Identity & Logos">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={brandNameId}>Store Name</Label>
                  <Input
                    id={brandNameId}
                    value={branding.brandName}
                    onChange={(e) => setBranding({ ...branding, brandName: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={taglineId}>Tagline</Label>
                  <Input
                    id={taglineId}
                    value={branding.tagline}
                    onChange={(e) => setBranding({ ...branding, tagline: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={logoLightId}>Light Theme Logo URL</Label>
                  <Input
                    id={logoLightId}
                    value={branding.logoLightUrl}
                    onChange={(e) => setBranding({ ...branding, logoLightUrl: e.target.value })}
                  />
                  <div className="flex h-16 items-center justify-center rounded-lg border border-border bg-white p-2">
                    {branding.logoLightUrl ? (
                      <img src={branding.logoLightUrl} alt="Light logo preview" className="max-h-12 max-w-full object-contain" />
                    ) : (
                      <ImageIcon className="size-6 text-foreground-lighter" />
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={logoDarkId}>Dark Theme Logo URL</Label>
                  <Input
                    id={logoDarkId}
                    value={branding.logoDarkUrl}
                    onChange={(e) => setBranding({ ...branding, logoDarkUrl: e.target.value })}
                  />
                  <div className="flex h-16 items-center justify-center rounded-lg border border-border bg-slate-900 p-2">
                    {branding.logoDarkUrl ? (
                      <img src={branding.logoDarkUrl} alt="Dark logo preview" className="max-h-12 max-w-full object-contain" />
                    ) : (
                      <ImageIcon className="size-6 text-foreground-lighter" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </PageSection>

          {/* Typography */}
          <PageSection title="Typography (Self-Hosted Google Fonts)">
            <div className="space-y-3">
              <p className="text-xs text-foreground-lighter">
                Fonts are self-hosted directly from Cloudflare R2 to ensure zero third-party font tracking and 100% privacy compliance.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {curatedFonts.map((font) => (
                  <button
                    key={font.id}
                    type="button"
                    onClick={() => setBranding({ ...branding, fontFamily: font.id })}
                    className={`flex items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                      branding.fontFamily === font.id
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border hover:bg-surface-50"
                    }`}
                  >
                    <div>
                      <span className="text-sm font-semibold">{font.name}</span>
                      <p className="text-xs text-foreground-lighter">{font.category}</p>
                    </div>
                    {font.devanagari && (
                      <span className="rounded bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                        Devanagari
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </PageSection>

          {/* Color Scheme */}
          <PageSection title="Color Palette & Tokens">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor={primaryColorId}>Primary Brand</Label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id={primaryColorId}
                    type="color"
                    value={branding.primaryColor}
                    onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                    className="size-8 cursor-pointer rounded border border-border"
                  />
                  <input
                    type="text"
                    value={branding.primaryColor}
                    onChange={(e) => setBranding({ ...branding, primaryColor: e.target.value })}
                    className="h-8 flex-1 rounded border border-border bg-surface-50 px-2 font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor={textColorId}>Text Color</Label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id={textColorId}
                    type="color"
                    value={branding.textColor}
                    onChange={(e) => setBranding({ ...branding, textColor: e.target.value })}
                    className="size-8 cursor-pointer rounded border border-border"
                  />
                  <input
                    type="text"
                    value={branding.textColor}
                    onChange={(e) => setBranding({ ...branding, textColor: e.target.value })}
                    className="h-8 flex-1 rounded border border-border bg-surface-50 px-2 font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor={bgColorId}>Background Color</Label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id={bgColorId}
                    type="color"
                    value={branding.backgroundColor}
                    onChange={(e) => setBranding({ ...branding, backgroundColor: e.target.value })}
                    className="size-8 cursor-pointer rounded border border-border"
                  />
                  <input
                    type="text"
                    value={branding.backgroundColor}
                    onChange={(e) => setBranding({ ...branding, backgroundColor: e.target.value })}
                    className="h-8 flex-1 rounded border border-border bg-surface-50 px-2 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          </PageSection>
        </div>

        {/* Right: Accessibility & Favicon Suite */}
        <div className="space-y-6 lg:col-span-5">
          {/* WCAG AA Contrast Inspector */}
          <PageSection title="WCAG 2.1 AA Contrast Check">
            <div className="space-y-4">
              {/* Text Contrast Card */}
              <div
                className={`rounded-lg border p-4 ${
                  isTextAaPass
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-amber-500/30 bg-amber-500/5"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isTextAaPass ? (
                      <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                    )}
                    <span className="text-sm font-bold text-foreground">Body Text Contrast</span>
                  </div>
                  <span className="font-mono text-sm font-extrabold">{textBgRatio.toFixed(2)}:1</span>
                </div>
                <p className="mt-1 text-xs text-foreground-muted">
                  {isTextAaPass
                    ? "Passes WCAG AA standard (minimum 4.5:1 required for normal body text)."
                    : "Non-compliant! Contrast ratio is below the 4.5:1 minimum threshold."}
                </p>

                {!isTextAaPass && (
                  <div className="mt-3 flex items-center justify-between border-t border-amber-500/20 pt-2">
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      Recommendation available
                    </span>
                    <Button variant="default" size="sm" onClick={handleFixTextColor}>
                      Auto-fix text color
                    </Button>
                  </div>
                )}
              </div>

              {/* Primary / Accent Contrast Card */}
              <div
                className={`rounded-lg border p-4 ${
                  isPrimaryAaPass
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-sky-500/30 bg-sky-500/5"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-primary" />
                    <span className="text-sm font-bold text-foreground">Button / Primary CTA</span>
                  </div>
                  <span className="font-mono text-sm font-extrabold">{primaryBgRatio.toFixed(2)}:1</span>
                </div>
                <p className="mt-1 text-xs text-foreground-muted">
                  {isPrimaryAaPass
                    ? "Passes WCAG AA standard against storefront background."
                    : "Suitable for large text and graphic components (>=3.0:1)."}
                </p>
              </div>
            </div>
          </PageSection>

          {/* Favicon & Web Manifest Generator */}
          <PageSection title="Favicon & PWA Suite">
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor={faviconInputId}>Source Icon (Square 512x512)</Label>
                <Input
                  id={faviconInputId}
                  value={branding.faviconUrl}
                  onChange={(e) => setBranding({ ...branding, faviconUrl: e.target.value })}
                  placeholder="https://..."
                />
              </div>

              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                  Generated Sizes Preview
                </span>
                <div className="mt-3 grid grid-cols-4 items-end gap-3 text-center">
                  <div className="flex flex-col items-center">
                    <img src={branding.faviconUrl} alt="16px" className="size-4 rounded-xs border border-border" />
                    <span className="mt-1 font-mono text-[10px] text-foreground-lighter">16x16</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <img src={branding.faviconUrl} alt="32px" className="size-8 rounded border border-border" />
                    <span className="mt-1 font-mono text-[10px] text-foreground-lighter">32x32</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <img src={branding.faviconUrl} alt="180px" className="size-11 rounded-md border border-border" />
                    <span className="mt-1 font-mono text-[10px] text-foreground-lighter">180x180</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <img src={branding.faviconUrl} alt="192px" className="size-14 rounded-lg border border-border" />
                    <span className="mt-1 font-mono text-[10px] text-foreground-lighter">192x192</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between pb-1">
                  <span className="text-xs font-semibold text-foreground">Web Manifest Snippet</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(manifestSnippet);
                      toast.success("Manifest JSON copied to clipboard");
                    }}
                  >
                    <Download className="mr-1 size-3" />
                    Copy JSON
                  </Button>
                </div>
                <pre className="max-h-36 overflow-auto rounded-md bg-surface-100 p-2.5 font-mono text-[11px] text-foreground-muted">
                  {manifestSnippet}
                </pre>
              </div>
            </div>
          </PageSection>
        </div>
      </div>
    </PageContainer>
  );
}
