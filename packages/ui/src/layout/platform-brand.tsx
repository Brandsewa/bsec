"use client";

import * as React from "react";

/** The public platform brand (docs/PLATFORM-BRANDING-PLAN.md). "dark"/"light" name the surface the asset sits on. */
export interface PlatformBrand {
  explicit: boolean;
  css: string;
  tokens: {
    logo: Record<"dark" | "light", { full: { url: string; alt?: string | undefined } | null; icon: { url: string; alt?: string | undefined } | null }>;
    favicon: { url: string } | null;
    identity?: { name: string; tagline: string };
    font?: string;
    logoSize?: { width: number | null; height: number | null };
  };
}

let current: PlatformBrand | null = null;
const listeners = new Set<() => void>();

/** Stores the brand and applies the CSS variables, primary colour and favicon to the document. Safe to call repeatedly. */
export function setPlatformBrand(brand: PlatformBrand | null): void {
  current = brand && brand.explicit ? brand : null;
  if (typeof document !== "undefined") {
    let style = document.getElementById("bs-brand-vars") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "bs-brand-vars";
      document.head.appendChild(style);
    }
    // css is built server-side from validated hex values only.
    style.textContent = current
      ? `${current.css}:root,.dark{--primary:var(--brand-primary);--primary-foreground:var(--brand-primary-foreground);--ring:var(--brand-primary);}${current.tokens.font && current.tokens.font !== "system" ? "body{font-family:var(--brand-font)}" : ""}`
      : "";
    const fav = current?.tokens.favicon?.url;
    if (fav) {
      let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = fav;
    }
  }
  listeners.forEach((l) => l());
}

/** Fetches the public brand once at boot. A failure keeps the built-in look. */
export async function loadPlatformBrand(url: string): Promise<void> {
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (res.ok) setPlatformBrand((await res.json()) as PlatformBrand);
  } catch {
    // keep the built-in look
  }
}

export function usePlatformBrand(): PlatformBrand | null {
  return React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
}

/** True once a platform brand with a full (horizontal) logo is loaded: sign-in pages then show it instead of their own mark. */
export function usePlatformLogoSet(): boolean {
  const brand = usePlatformBrand();
  return Boolean(brand && (brand.tokens.logo.dark.full || brand.tokens.logo.light.full));
}

/**
 * The platform logo for the active theme (the dark asset on dark surfaces). `full` is the horizontal logo and never falls
 * back to the icon. Size comes from Super Admin > Branding (`--brand-logo-w/h`); automatic sizes use a 40px height.
 */
export function PlatformLogo({ kind = "full", className }: { kind?: "full" | "icon"; className?: string | undefined }) {
  const brand = usePlatformBrand();
  if (!brand) return null;
  const { dark, light } = brand.tokens.logo;
  const pick = (s: typeof dark) => (kind === "full" ? s.full : s.icon);
  const d = pick(dark) ?? pick(light);
  const l = pick(light) ?? d;
  if (!d || !l) {
    // No logo uploaded: fall back to the brand name as a text wordmark, if one is set.
    const name = brand.tokens.identity?.name;
    return name ? <span className={className ?? "text-lg font-semibold"}>{name}</span> : null;
  }
  const style = kind === "full" ? ({ width: "var(--brand-logo-w, auto)", height: "var(--brand-logo-h, 40px)" } as const) : undefined;
  const cls = className ?? (kind === "full" ? "max-w-full object-contain" : "size-8 object-contain");
  return (
    <>
      <img src={l.url} alt={l.alt || "Logo"} style={style} className={`${cls} dark:hidden`} />
      <img src={d.url} alt={d.alt || "Logo"} style={style} className={`hidden ${cls} dark:block`} />
    </>
  );
}
