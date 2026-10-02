/**
 * Which hostnames belong to the platform's own public site (marketing page, signup) rather than to a store.
 * Pure on purpose: it is imported by the edge middleware and by the root layout, which must agree.
 */
export function platformMarketingHostnames(env: Record<string, string | undefined> = process.env): string[] {
  const platformDomain = (env.PLATFORM_DOMAIN || "bcom.si").toLowerCase();
  const marketingHost = (env.MARKETING_HOST || platformDomain).toLowerCase();
  return [...new Set([marketingHost, platformDomain, `www.${platformDomain}`])];
}

/** The hostname part of a Host / X-Forwarded-Host header value (no port, lower case). */
export function hostnameOf(host: string | null | undefined): string {
  return (host ?? "localhost").split(",")[0]?.trim().split(":")[0]?.toLowerCase() || "localhost";
}

/** True for bcom.si, www.bcom.si and MARKETING_HOST: hosts that show the platform site, not a store. */
export function isPlatformMarketingHost(host: string | null | undefined, env?: Record<string, string | undefined>): boolean {
  return platformMarketingHostnames(env).includes(hostnameOf(host));
}
