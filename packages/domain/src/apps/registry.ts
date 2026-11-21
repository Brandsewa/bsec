import { z } from "zod";

/**
 * First-party app manifests (ADR-043). Apps are our own code, never merchant code (rule 8): this registry decides which
 * settings an app accepts, and the catalog row in `platform_apps` decides who can see it.
 */
export const STATE_PRICING_APP = "state-pricing";

/** "auto": the detected state sets the price. "manual": a pincode popup asks the shopper at first load (owner decision 2026-11-03). */
export const statePricingSettingsSchema = z.object({
  mode: z.enum(["auto", "manual"]).default("auto"),
});
export type StatePricingSettings = z.infer<typeof statePricingSettingsSchema>;

export interface AppManifest {
  key: string;
  settingsSchema: z.ZodType<Record<string, unknown>>;
  defaultSettings: Record<string, unknown>;
}

export const APP_MANIFESTS: Readonly<Record<string, AppManifest>> = {
  [STATE_PRICING_APP]: {
    key: STATE_PRICING_APP,
    settingsSchema: statePricingSettingsSchema as unknown as z.ZodType<Record<string, unknown>>,
    defaultSettings: { mode: "auto" },
  },
};

export function manifestFor(key: string): AppManifest | undefined {
  return APP_MANIFESTS[key];
}
