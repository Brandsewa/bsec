import { MapPin, Puzzle, type LucideIcon } from "lucide-react";
import type { StoreAppRecord } from "@bs/contracts";

/** Icons by the name stored in the app catalog (platform_apps.icon); unknown names fall back to a puzzle piece. */
const ICONS: Record<string, LucideIcon> = { "map-pin": MapPin, puzzle: Puzzle };
export const appIcon = (name: string): LucideIcon => ICONS[name] ?? Puzzle;

/** Where an app's own configuration page lives. Apps without a page are managed from Settings > Apps only. */
const APP_HREFS: Record<string, string> = { "state-pricing": "/apps/state-pricing" };
export const appHref = (key: string): string | null => APP_HREFS[key] ?? null;

/** Installed, switched on and not suspended by Super Admin. */
export const isAppOn = (a: StoreAppRecord) => a.installed && a.status === "installed" && !a.suspended;
