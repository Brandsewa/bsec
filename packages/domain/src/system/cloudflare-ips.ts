import { BlockList, isIP } from "node:net";

/**
 * Cloudflare's published edge ranges (https://www.cloudflare.com/ips/, copied 2026-11-20). They change rarely; refresh
 * this list when Cloudflare announces a change. Used by getClientIp so the CF-Connecting-IP header is believed only
 * when the request really arrived from a Cloudflare address (SEC-001).
 */
const CLOUDFLARE_V4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];
const CLOUDFLARE_V6 = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

const ranges = new BlockList();
function addRanges(cidrs: readonly string[], family: "ipv4" | "ipv6"): void {
  for (const cidr of cidrs) {
    const [net = "", bits = ""] = cidr.split("/");
    ranges.addSubnet(net, Number(bits), family);
  }
}
addRanges(CLOUDFLARE_V4, "ipv4");
addRanges(CLOUDFLARE_V6, "ipv6");

/** True when `ip` (plain IPv4 or IPv6, an IPv4-mapped IPv6 form is accepted) is inside a Cloudflare edge range. */
export function isCloudflareAddress(ip: string): boolean {
  const addr = ip.trim().replace(/^::ffff:/i, "");
  const family = isIP(addr);
  if (family === 4) return ranges.check(addr, "ipv4");
  if (family === 6) return ranges.check(addr, "ipv6");
  return false;
}
