import { getPlatformSitePolicy, getPlatformSitePrivacy, getPlatformSiteStatus } from "@bs/domain";
import { server } from "@/server/runtime.ts";

/** What the website's Settings say (ADR-042). Every reader falls back to "as before": live, built-in text, built-in contact. */
export const siteStatus = () => getPlatformSiteStatus(server().rt._db.db);
export const sitePolicy = (handle: "terms" | "privacy" | "refund" | "shipping" | "legal_notice") => getPlatformSitePolicy(server().rt._db.db, handle);
export const sitePrivacy = () => getPlatformSitePrivacy(server().rt);
