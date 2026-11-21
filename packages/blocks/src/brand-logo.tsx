/**
 * The platform's brand logo on the website (docs/PLATFORM-BRANDING-PLAN.md). Both theme variants are rendered and the
 * marketing stylesheet shows the right one, so it needs no script and cannot mismatch on hydration. Size comes from
 * `--brand-logo-w/h` (Super Admin > Branding); an automatic size falls back to a 32px height.
 */
import type { ReactNode } from "react";

export interface BrandLogoAsset {
  url: string;
  alt?: string | undefined;
}
export interface BrandLogoPair {
  dark: BrandLogoAsset | null;
  light: BrandLogoAsset | null;
}

export function BrandLogoImg({ logo, fallback, name }: { logo: BrandLogoPair | null | undefined; fallback: ReactNode; name: string }) {
  const light = logo?.light ?? logo?.dark ?? null;
  const dark = logo?.dark ?? logo?.light ?? null;
  if (!light || !dark) return <>{fallback}</>;
  const style = { width: "var(--brand-logo-w, auto)", height: "var(--brand-logo-h, 32px)" } as const;
  return (
    <span className="logo-img">
      <img className="when-light" src={light.url} alt={light.alt || name} style={style} />
      {light.url === dark.url ? null : (
        <img className="when-dark" src={dark.url} alt={dark.alt || name} style={style} />
      )}
    </span>
  );
}
