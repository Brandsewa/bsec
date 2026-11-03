import { cache } from "react";
import { connection } from "next/server";
import { getPlatformSiteChrome, getPlatformSitePrivacy, getPlatformSiteStatus, type PlatformSiteChrome, type PlatformSiteStatus } from "@bs/domain";
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

export async function sitePrivacy() {
  await connection();
  try {
    return await getPlatformSitePrivacy(server().rt);
  } catch {
    return null;
  }
}

/** The website's published header, announcement bar and footer; nulls keep the built-in ones. Read once per request. */
export const siteChrome = cache(async (): Promise<PlatformSiteChrome> => {
  await connection();
  return getPlatformSiteChrome(server().rt._db.db);
});
