/**
 * Marketing landing designs under evaluation. Home 1 is the default everyone sees. The switcher and the
 * ?design=N override only exist when NEXT_PUBLIC_MARKETING_DESIGN_SWITCHER=1 (local testing); production ignores both.
 */
export interface MarketingDesign {
  id: string;
  label: string;
  note: string;
  built: boolean;
}

export const MARKETING_DESIGNS: readonly MarketingDesign[] = [
  { id: "1", label: "Home 1", note: "Block-Print Bazaar (indigo cloth, carved blocks)", built: true },
  { id: "2", label: "Home 2", note: "The Bahi-Khata (red ledger, ruled paper)", built: true },
  { id: "3", label: "Home 3", note: "Riso Zine (spot inks, overprint, halftone)", built: true },
  { id: "4", label: "Home 4", note: "Neubrutalist Grid (not built yet)", built: false },
];

export const DEFAULT_DESIGN = "1";

export function designSwitcherEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MARKETING_DESIGN_SWITCHER === "1";
}

/** Picks the design to render: only honours a request when the switcher is enabled and the design is built. */
export function resolveDesign(requested: string | undefined | null): string {
  if (!designSwitcherEnabled()) return DEFAULT_DESIGN;
  const hit = MARKETING_DESIGNS.find((d) => d.id === requested && d.built);
  return hit ? hit.id : DEFAULT_DESIGN;
}
