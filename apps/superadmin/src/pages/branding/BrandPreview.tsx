import { useState } from "react";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { shadeRamp } from "../../lib/contrast.ts";

interface Asset {
  url: string;
  alt?: string | undefined;
}
export interface PreviewTokens {
  logo: { dark: { full: Asset | null; icon: Asset | null }; light: { full: Asset | null; icon: Asset | null } };
  color: { primary: string; secondary: string };
  button: { dark: { background: string; text: string }; light: { background: string; text: string } };
  identity: { name: string; tagline: string };
}

const HEX = /^#[0-9a-f]{6}$/i;
const ok = (v: string, fallback: string) => (HEX.test(v) ? v : fallback);
// Light/dark surfaces are theme-independent previews, so they use fixed utility classes rather than app tokens.

/** A small, static picture of how the brand lands on each surface. Updates live as the draft changes. */
export function BrandPreview({ tokens, defaults, fontStack }: { tokens: PreviewTokens; defaults: PreviewTokens; fontStack: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const dark = theme === "dark";
  const surface = dark ? "bg-neutral-900 text-neutral-50" : "bg-white text-neutral-900";
  const btn = tokens.button[theme];
  const primary = ok(tokens.color.primary, defaults.color.primary);
  const secondary = ok(tokens.color.secondary, defaults.color.secondary);
  const set = tokens.logo[theme];
  const logo = set.full ?? set.icon ?? tokens.logo[dark ? "light" : "dark"].full;
  const emailLogo = tokens.logo.light.full ?? tokens.logo.dark.full;
  const mark = logo ? (
    <img src={logo.url} alt={logo.alt || "Logo"} className="h-6 max-w-28 object-contain" />
  ) : (
    <span className="text-sm font-semibold">{tokens.identity.name || "Your brand"}</span>
  );
  const button = (label: string) => (
    <span className="inline-block rounded-md px-3 py-1.5 text-xs font-medium" style={{ background: ok(btn.background, primary), color: ok(btn.text, defaults.button[theme].text) }}>
      {label}
    </span>
  );
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Preview</CardTitle>
          <CardDescription>How the brand looks on each surface. Updates as you edit.</CardDescription>
        </div>
        <div className="flex gap-1">
          {(["light", "dark"] as const).map((t) => (
            <Button key={t} type="button" size="sm" variant={theme === t ? "default" : "outline"} onClick={() => setTheme(t)} className="capitalize">
              {t}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4" style={{ fontFamily: fontStack }}>
        <div className={`overflow-hidden rounded-lg border border-border ${surface}`}>
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            {mark}
            <div className="flex items-center gap-2 text-xs">
              <span>Pricing</span>
              <span>Blog</span>
              {button("Start free")}
            </div>
          </div>
          <div className="px-3 py-6 text-center">
            <p className="text-base font-semibold">{tokens.identity.tagline || "Your tagline appears here"}</p>
            <div className="mt-3">{button("Get started")}</div>
          </div>
        </div>

        <div className={`grid grid-cols-[7rem_1fr] overflow-hidden rounded-lg border border-border ${surface}`}>
          <div className="grid content-start gap-1 p-2 text-xs text-white" style={{ background: secondary }}>
            {mark}
            <span className="rounded px-1.5 py-1" style={{ background: primary }}>
              Dashboard
            </span>
            <span className="px-1.5 py-1 opacity-80">Orders</span>
          </div>
          <div className="p-3">
            <p className="mb-2 text-sm font-medium">Dashboard</p>
            {button("Save changes")}
          </div>
        </div>

        <div className={`rounded-lg border border-border p-4 ${surface}`}>
          <div className="mx-auto grid max-w-48 gap-2 text-center">
            <div className="flex justify-center">{mark}</div>
            <p className="text-xs">Sign in to continue</p>
            <div className="h-6 rounded border border-border" />
            {button("Sign in")}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-white text-neutral-900">
          <div className="px-3 py-2" style={{ borderBottom: `3px solid ${primary}` }}>
            {emailLogo ? <img src={emailLogo.url} alt="" className="h-5 max-w-24 object-contain" /> : <span className="text-sm font-semibold">{tokens.identity.name || "Your brand"}</span>}
          </div>
          <div className="px-3 py-3 text-xs">
            <p>Your order is on its way.</p>
            <p className="mt-2" style={{ color: primary }}>
              Track your order
            </p>
          </div>
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            Primary shades <Badge variant="secondary">derived</Badge>
          </p>
          <div className="flex overflow-hidden rounded-md border border-border">
            {shadeRamp(primary).map((s) => (
              <div key={s.step} title={`${s.step} ${s.hex}`} className="h-8 flex-1" style={{ background: s.hex }} />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
