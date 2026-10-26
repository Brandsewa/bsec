/** Second-level suffixes where "brand.co.in" is a bare (apex) domain even though it has three labels. */
const TWO_PART_SUFFIXES = new Set([
  "co.in", "org.in", "net.in", "firm.in", "gen.in", "ind.in", "ac.in", "edu.in", "gov.in",
  "co.uk", "org.uk", "me.uk", "com.au", "net.au", "org.au", "co.nz", "com.sg", "co.za", "com.br", "co.jp",
]);

/**
 * True for a bare domain such as "mybrand.com" or "mybrand.co.in", where DNS does not allow a plain CNAME and the
 * merchant needs A records (or ALIAS/ANAME/CNAME flattening) instead. Heuristic: it only needs to be right for the
 * common cases, and the platform's own DNS check tells the merchant what it actually sees.
 */
export function isApexDomain(hostname: string): boolean {
  const labels = hostname.trim().toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return true;
  return labels.length === 3 && TWO_PART_SUFFIXES.has(labels.slice(1).join("."));
}

export type RoutingView = {
  status: "unknown" | "dns_missing" | "dns_wrong" | "dns_ok" | "reachable";
  seen: { a: string[]; aaaa: string[]; cname: string | null };
  probeFailed: boolean;
  failures: number;
  checkedAt: string | null;
  expected: { cname: string; a: string[]; aaaa: string[] };
};

/** One plain sentence about what the last check saw, for the "point your domain to us" step. */
export function describeRouting(hostname: string, routing: RoutingView | undefined): { tone: "ok" | "wait" | "problem"; text: string } {
  if (!routing || routing.status === "unknown") {
    return { tone: "wait", text: "Not checked yet. Add the record, then press Check status." };
  }
  const seen = [...routing.seen.a, ...routing.seen.aaaa, ...(routing.seen.cname ? [routing.seen.cname] : [])];
  switch (routing.status) {
    case "dns_missing":
      return { tone: "problem", text: `We see no DNS record for ${hostname} yet. Add the record below (it can take a few minutes to appear).` };
    case "dns_wrong":
      return {
        tone: "problem",
        text: `We see ${seen.join(", ")} for ${hostname}, which is not our server. Remove the old record and add the one below.`,
      };
    case "dns_ok":
      return {
        tone: "wait",
        text: routing.probeFailed
          ? "Your DNS points to us. We are waiting for the certificate and the site to answer; this usually takes a few minutes."
          : "Your DNS points to us. Finishing the connection.",
      };
    case "reachable":
      return { tone: "ok", text: "Your domain reaches your store." };
  }
}
