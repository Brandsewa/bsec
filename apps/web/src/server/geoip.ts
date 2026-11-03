import "server-only";
import { normalizeIndianState, type InStateCode } from "@bs/domain";

/**
 * MaxMind GeoLite2-City lookup, the fallback behind Cloudflare's region header (ADR-044). The database file is not in
 * the repo (licence, size): point GEOIP_DB_PATH at a GeoLite2-City.mmdb, or at the India-only extract built by
 * scripts/build-india-geoip.py. Without the file every lookup returns null and the store simply shows default prices.
 */
interface Reader {
  get(ip: string): { country?: { iso_code?: string } | undefined; subdivisions?: { iso_code?: string }[] | undefined } | null;
}

let readerPromise: Promise<Reader | null> | undefined;

async function openReader(): Promise<Reader | null> {
  const path = process.env.GEOIP_DB_PATH;
  if (!path) return null;
  try {
    const { open } = await import("maxmind");
    type CityResponse = import("maxmind").CityResponse;
    return (await open<CityResponse>(path)) as unknown as Reader;
  } catch (err) {
    console.error("[geoip] could not open the database", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function lookupIndianStateByIp(ip: string): Promise<InStateCode | null> {
  readerPromise ??= openReader();
  const reader = await readerPromise;
  if (!reader) return null;
  try {
    const rec = reader.get(ip);
    if (!rec || rec.country?.iso_code !== "IN") return null;
    return normalizeIndianState(rec.subdivisions?.[0]?.iso_code);
  } catch {
    return null;
  }
}
