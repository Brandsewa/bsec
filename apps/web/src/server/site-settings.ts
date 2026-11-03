import { connection } from "next/server";
import { getPlatformSitePolicy, getPlatformSitePrivacy, getPlatformSiteStatus, type PlatformSiteStatus } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/**
 * What the website's Settings say (ADR-042). Every reader falls back to "as before": live, built-in text, built-in
 * contact. Each waits for a real request first: the legal pages are prerendered at build time, where there is no
 * database, and a read made then would be frozen into the page.
 */
const LIVE: PlatformSiteStatus = { mode: "live", headline: null, showCountdown: false, launchAt: null, hideFromSearchEngines: false };

export async function siteStatus(): Promise<PlatformSiteStatus> {
  await connection();
  try {
    return await getPlatformSiteStatus(server().rt._db.db);
  } catch {
    return LIVE;
  }
}

export async function sitePolicy(handle: "terms" | "privacy" | "refund" | "shipping" | "legal_notice") {
  await connection();
  try {
    return await getPlatformSitePolicy(server().rt._db.db, handle);
  } catch {
    return null;
  }
}

export async function sitePrivacy() {
  await connection();
  try {
    return await getPlatformSitePrivacy(server().rt);
  } catch {
    return null;
  }
}
