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

/** The platform logo for the active theme (dark logo on dark surfaces). Renders nothing until a brand is saved. */
export function PlatformLogo({ kind = "full", className }: { kind?: "full" | "icon"; className?: string | undefined }) {
  const brand = usePlatformBrand();
  if (!brand) return null;
  const { dark, light } = brand.tokens.logo;
  const pick = (s: typeof dark) => (kind === "full" ? (s.full ?? s.icon) : (s.icon ?? s.full));
  const d = pick(dark) ?? pick(light);
  const l = pick(light) ?? d;
  if (!d || !l) {
    // No logo uploaded: fall back to the brand name as a text wordmark, if one is set.
    const name = brand.tokens.identity?.name;
    return name ? <span className={className ?? "text-lg font-semibold"}>{name}</span> : null;
  }
  return (
    <>
      <img src={l.url} alt={l.alt || "Logo"} className={`${className ?? "h-10 max-w-48 object-contain"} dark:hidden`} />
      <img src={d.url} alt={d.alt || "Logo"} className={`hidden ${className ?? "h-10 max-w-48 object-contain"} dark:block`} />
    </>
  );
}
