import type { StorefrontMode } from "./lifecycle.ts";

/**
 * In-memory registry tracking last known storefront modes and lookup failure telemetry.
 * Implements the resilience & protection requirements of PLAN §8.2 / Settings Phase 8:
 * - Fail-open for brief database blips on LIVE stores to prevent outages
 * - Fail-closed for PASSWORD, MAINTENANCE, and COMING_SOON stores so confidential/unready
 *   catalogs are NEVER served to unauthenticated visitors during an outage.
 */

interface HostModeEntry {
  mode: StorefrontMode;
  updatedAt: number;
}

const lastKnownHostModes = new Map<string, HostModeEntry>();
let lookupFailureCount = 0;

export function recordHostMode(host: string, mode: StorefrontMode): void {
  if (!host) return;
  lastKnownHostModes.set(host.toLowerCase().trim(), {
    mode,
    updatedAt: Date.now(),
  });
}

export function getLastKnownHostMode(host: string): StorefrontMode | undefined {
  if (!host) return undefined;
  return lastKnownHostModes.get(host.toLowerCase().trim())?.mode;
}

export function recordLookupFailure(
  host: string,
  _error?: unknown,
): { failureCount: number; fallbackMode: StorefrontMode } {
  lookupFailureCount++;
  const known = getLastKnownHostMode(host);
  // Fail closed if store was known to require password, maintenance, or coming_soon
  // Default to live for brief DB blips on ordinary stores
  const fallbackMode = known ?? "live";
  return { failureCount: lookupFailureCount, fallbackMode };
}

export function getLookupFailureStats(): { totalFailures: number; trackedHosts: number } {
  return {
    totalFailures: lookupFailureCount,
    trackedHosts: lastKnownHostModes.size,
  };
}

export function resetLookupFailureStatsForTest(): void {
  lookupFailureCount = 0;
  lastKnownHostModes.clear();
}
