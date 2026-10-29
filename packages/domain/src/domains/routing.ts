import { BlockList, isIP } from "node:net";
import { Resolver } from "node:dns/promises";

/**
 * Custom-domain routing checks (docs/CUSTOM-DOMAIN-ROUTING-PLAN.md).
 * Cloudflare reports a custom hostname "active" once ownership and the certificate are done; that says nothing about
 * whether the merchant's DNS sends visitors to us. These checks look at the real DNS and make a real request.
 */

export type RoutingStatus = "unknown" | "dns_missing" | "dns_wrong" | "dns_ok" | "reachable";

export interface RoutingTargets {
  cname: string;
  a: string[];
  aaaa: string[];
}

export interface DnsResolverLike {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
  resolveCname(host: string): Promise<string[]>;
}

export interface RoutingDetail {
  a: string[];
  aaaa: string[];
  cname: string | null;
  /** Result of the HTTP probe; absent when DNS did not pass so no request was made. */
  probe?: "ok" | "failed";
  probeReason?: string;
  /** Consecutive failed re-checks of an already active domain (3 flips it to "degraded"). */
  failures: number;
}

export interface RoutingResult {
  status: RoutingStatus;
  detail: RoutingDetail;
}

/** Cloudflare's published proxy ranges (https://www.cloudflare.com/ips/). Any of them routes by Host/SNI to our custom hostname. */
const CLOUDFLARE_RANGES: Array<[string, number, "ipv4" | "ipv6"]> = [
  ["173.245.48.0", 20, "ipv4"], ["103.21.244.0", 22, "ipv4"], ["103.22.200.0", 22, "ipv4"], ["103.31.4.0", 22, "ipv4"],
  ["141.101.64.0", 18, "ipv4"], ["108.162.192.0", 18, "ipv4"], ["190.93.240.0", 20, "ipv4"], ["188.114.96.0", 20, "ipv4"],
  ["197.234.240.0", 22, "ipv4"], ["198.41.128.0", 17, "ipv4"], ["162.158.0.0", 15, "ipv4"], ["104.16.0.0", 13, "ipv4"],
  ["104.24.0.0", 14, "ipv4"], ["172.64.0.0", 13, "ipv4"], ["131.0.72.0", 22, "ipv4"],
  ["2400:cb00::", 32, "ipv6"], ["2606:4700::", 32, "ipv6"], ["2803:f800::", 32, "ipv6"], ["2405:b500::", 32, "ipv6"],
  ["2405:8100::", 32, "ipv6"], ["2a06:98c0::", 29, "ipv6"], ["2c0f:f248::", 32, "ipv6"],
];

const cloudflareRanges = new BlockList();
for (const [net, bits, family] of CLOUDFLARE_RANGES) cloudflareRanges.addSubnet(net, bits, family);

export function isCloudflareIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  return cloudflareRanges.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/** Public resolvers, not the container's own, so the answer matches what shoppers' resolvers see. */
export function createPublicResolver(): DnsResolverLike {
  const r = new Resolver({ timeout: 3000, tries: 2 });
  r.setServers(["1.1.1.1", "8.8.8.8"]);
  return r;
}

function stripDot(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

async function safeList(fn: () => Promise<string[]>): Promise<string[]> {
  try {
    return await fn();
  } catch {
    // ENODATA / ENOTFOUND: the record type simply is not there.
    return [];
  }
}

/** Second-level suffixes where "brand.co.in" is a bare domain. Keep in step with apps/admin/src/lib/domain-hosts.ts. */
const TWO_PART_SUFFIXES = new Set([
  "co.in", "org.in", "net.in", "firm.in", "gen.in", "ind.in", "ac.in", "edu.in", "gov.in",
  "co.uk", "org.uk", "me.uk", "com.au", "net.au", "org.au", "co.nz", "com.sg", "co.za", "com.br", "co.jp",
]);

/**
 * True for a bare (apex) domain such as "mybrand.com". A bare domain cannot CNAME to us, so it is pointed with A records
 * that resolve to Cloudflare; Cloudflare then refuses TXT/HTTP ownership validation ("hostname is using Cloudflare").
 * Ownership must therefore be proven by TXT *before* those records exist.
 */
export function isApexHostname(hostname: string): boolean {
  const labels = hostname.trim().toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return true;
  return labels.length === 3 && TWO_PART_SUFFIXES.has(labels.slice(1).join("."));
}

export function fallbackOriginHost(): string {
  return (
    process.env.CUSTOM_DOMAIN_CNAME_TARGET?.trim() || `stores.${process.env.PLATFORM_DOMAIN?.trim() || "bcom.si"}`
  );
}

const TARGET_TTL_MS = 10 * 60_000;
let targetCache: { key: string; value: RoutingTargets; expiresAt: number } | null = null;

/**
 * What a merchant must point their domain at. Cloudflare for SaaS gives no fixed IP on our plan, so the A/AAAA
 * answers are read live from the fallback origin (`CUSTOM_DOMAIN_A_TARGETS` pins them if the owner wants that).
 */
export async function getRoutingTargets(resolver: DnsResolverLike = createPublicResolver()): Promise<RoutingTargets> {
  const cname = fallbackOriginHost();
  const pinned = (process.env.CUSTOM_DOMAIN_A_TARGETS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const key = `${cname}|${pinned.join(",")}`;
  if (targetCache && targetCache.key === key && targetCache.expiresAt > Date.now()) return targetCache.value;

  let value: RoutingTargets;
  if (pinned.length > 0) {
    value = { cname, a: pinned.filter((ip) => isIP(ip) === 4), aaaa: pinned.filter((ip) => isIP(ip) === 6) };
  } else {
    const [a, aaaa] = await Promise.all([safeList(() => resolver.resolve4(cname)), safeList(() => resolver.resolve6(cname))]);
    value = { cname, a: a.sort(), aaaa: aaaa.sort() };
    // Do not cache an empty answer: it is most likely a transient lookup failure.
    if (a.length === 0 && aaaa.length === 0) return value;
  }
  targetCache = { key, value, expiresAt: Date.now() + TARGET_TTL_MS };
  return value;
}

export function resetRoutingTargetCache(): void {
  targetCache = null;
}

/** DNS step: what does the hostname point at, and is that us (or at least Cloudflare)? */
export async function checkDomainDns(
  hostname: string,
  opts: { resolver?: DnsResolverLike; targets?: RoutingTargets } = {},
): Promise<{ status: Extract<RoutingStatus, "dns_missing" | "dns_wrong" | "dns_ok">; detail: RoutingDetail }> {
  const resolver = opts.resolver ?? createPublicResolver();
  const targets = opts.targets ?? (await getRoutingTargets(resolver));

  const [a, aaaa, cnames] = await Promise.all([
    safeList(() => resolver.resolve4(hostname)),
    safeList(() => resolver.resolve6(hostname)),
    safeList(() => resolver.resolveCname(hostname)),
  ]);
  const cname = cnames[0] ? stripDot(cnames[0]) : null;
  const detail: RoutingDetail = { a: [...a].sort(), aaaa: [...aaaa].sort(), cname, failures: 0 };

  if (a.length === 0 && aaaa.length === 0 && !cname) return { status: "dns_missing", detail };

  const pointsAtUs =
    (cname !== null && cname === stripDot(targets.cname)) ||
    [...a, ...aaaa].some((ip) => targets.a.includes(ip) || targets.aaaa.includes(ip) || isCloudflareIp(ip));
  return { status: pointsAtUs ? "dns_ok" : "dns_wrong", detail };
}

export type ProbeFetch = (url: string, init: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

const PROBE_PATH = "/.well-known/bsec-domain";
const PROBE_MAX_BYTES = 2048;

/**
 * HTTP step: ask the domain itself who it belongs to. Only the merchant's own validated hostname is fetched, redirects
 * are never followed, the body is size-capped and only compared to the domain id (never echoed anywhere). The probe runs
 * only after the DNS step saw Cloudflare or our own addresses, which keeps private addresses out of reach.
 */
export async function probeDomain(
  hostname: string,
  expectedDomainId: string,
  fetchImpl: ProbeFetch = fetch as unknown as ProbeFetch,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetchImpl(`https://${hostname}${PROBE_PATH}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/json", "User-Agent": "bsec-domain-check/1" },
    });
    if (res.status !== 200) return { ok: false, reason: `http_${res.status}` };
    const body = (await res.text()).slice(0, PROBE_MAX_BYTES);
    const parsed = JSON.parse(body) as { domainId?: unknown };
    if (parsed.domainId === expectedDomainId) return { ok: true };
    return { ok: false, reason: "wrong_store" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    return { ok: false, reason: /abort|timeout/i.test(msg) ? "timeout" : "unreachable" };
  }
}

/** Both steps in order; the probe is skipped when DNS does not pass. */
export async function checkDomainRouting(
  hostname: string,
  domainId: string,
  deps: { resolver?: DnsResolverLike; targets?: RoutingTargets; fetchImpl?: ProbeFetch } = {},
): Promise<RoutingResult> {
  const dns = await checkDomainDns(hostname, {
    ...(deps.resolver ? { resolver: deps.resolver } : {}),
    ...(deps.targets ? { targets: deps.targets } : {}),
  });
  if (dns.status !== "dns_ok") return dns;
  const probe = await probeDomain(hostname, domainId, deps.fetchImpl);
  return {
    status: probe.ok ? "reachable" : "dns_ok",
    detail: { ...dns.detail, probe: probe.ok ? "ok" : "failed", ...(probe.reason ? { probeReason: probe.reason } : {}) },
  };
}

/** The shape the admin API returns for a domain's routing state (see CustomDomainRouting in @bs/contracts). */
export function toRoutingView(
  row: { routingStatus: string | null; routingDetail: unknown; routingCheckedAt: Date | null },
  expected: RoutingTargets,
) {
  const detail = (row.routingDetail ?? null) as RoutingDetail | null;
  const status: RoutingStatus = (["dns_missing", "dns_wrong", "dns_ok", "reachable"] as const).find((s) => s === row.routingStatus) ?? "unknown";
  return {
    status,
    seen: { a: detail?.a ?? [], aaaa: detail?.aaaa ?? [], cname: detail?.cname ?? null },
    probeFailed: detail?.probe === "failed",
    failures: detail?.failures ?? 0,
    checkedAt: row.routingCheckedAt ? row.routingCheckedAt.toISOString() : null,
    expected,
  };
}
