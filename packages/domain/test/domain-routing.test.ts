import { afterEach, describe, expect, it } from "vitest";
import {
  checkDomainDns,
  checkDomainRouting,
  getRoutingTargets,
  isCloudflareIp,
  probeDomain,
  resetRoutingTargetCache,
  toRoutingView,
  type DnsResolverLike,
} from "../src/domains/routing.ts";

const none = () => Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }));
const resolver = (r: { a?: string[]; aaaa?: string[]; cname?: string[] }): DnsResolverLike => ({
  resolve4: async () => r.a ?? (await none()),
  resolve6: async () => r.aaaa ?? (await none()),
  resolveCname: async () => r.cname ?? (await none()),
});
const targets = { cname: "stores.bcom.si", a: ["104.21.59.175", "172.67.182.4"], aaaa: [] as string[] };

afterEach(() => {
  resetRoutingTargetCache();
  delete process.env.CUSTOM_DOMAIN_A_TARGETS;
});

describe("isCloudflareIp", () => {
  it("recognises Cloudflare ranges and rejects others", () => {
    expect(isCloudflareIp("104.21.59.175")).toBe(true);
    expect(isCloudflareIp("172.67.182.4")).toBe(true);
    expect(isCloudflareIp("2606:4700:3030::6815:3baf")).toBe(true);
    expect(isCloudflareIp("84.32.84.32")).toBe(false);
    expect(isCloudflareIp("10.0.0.5")).toBe(false);
    expect(isCloudflareIp("not-an-ip")).toBe(false);
  });
});

describe("getRoutingTargets", () => {
  it("reads the fallback origin's addresses live and sorts them", async () => {
    const t = await getRoutingTargets(resolver({ a: ["172.67.182.4", "104.21.59.175"], aaaa: ["2606:4700:3030::6815:3baf"] }));
    expect(t.cname).toBe("stores.bcom.si");
    expect(t.a).toEqual(["104.21.59.175", "172.67.182.4"]);
    expect(t.aaaa).toEqual(["2606:4700:3030::6815:3baf"]);
  });
  it("honours the pinned override and does not cache an empty lookup", async () => {
    process.env.CUSTOM_DOMAIN_A_TARGETS = "1.2.3.4, 2001:db8::1";
    expect(await getRoutingTargets(resolver({}))).toEqual({ cname: "stores.bcom.si", a: ["1.2.3.4"], aaaa: ["2001:db8::1"] });
    delete process.env.CUSTOM_DOMAIN_A_TARGETS;
    resetRoutingTargetCache();
    expect((await getRoutingTargets(resolver({}))).a).toEqual([]);
    expect((await getRoutingTargets(resolver({ a: ["104.21.59.175"] }))).a).toEqual(["104.21.59.175"]);
  });
});

describe("checkDomainDns", () => {
  it("dns_missing: bare domain with no A, AAAA or CNAME (the darjeelinghoney.com case)", async () => {
    const r = await checkDomainDns("darjeelinghoney.com", { resolver: resolver({}), targets });
    expect(r.status).toBe("dns_missing");
  });
  it("dns_wrong: a parking page address", async () => {
    const r = await checkDomainDns("a.com", { resolver: resolver({ a: ["84.32.84.32"] }), targets });
    expect(r.status).toBe("dns_wrong");
    expect(r.detail.a).toEqual(["84.32.84.32"]);
  });
  it("dns_ok: A record equal to one of our addresses, a Cloudflare address, or a CNAME to the fallback origin", async () => {
    expect((await checkDomainDns("a.com", { resolver: resolver({ a: ["104.21.59.175"] }), targets })).status).toBe("dns_ok");
    expect((await checkDomainDns("a.com", { resolver: resolver({ a: ["104.18.1.1"] }), targets })).status).toBe("dns_ok");
    expect((await checkDomainDns("www.a.com", { resolver: resolver({ a: ["84.1.1.1"], cname: ["Stores.bcom.si."] }), targets })).status).toBe("dns_ok");
  });
  it("dns_ok with only an IPv6 Cloudflare address", async () => {
    expect((await checkDomainDns("a.com", { resolver: resolver({ aaaa: ["2606:4700:3031::ac43:b604"] }), targets })).status).toBe("dns_ok");
  });
  it("dns_wrong when a CNAME points somewhere else", async () => {
    const r = await checkDomainDns("www.a.com", { resolver: resolver({ cname: ["shops.example.net."] }), targets });
    expect(r.status).toBe("dns_wrong");
    expect(r.detail.cname).toBe("shops.example.net");
  });
});

describe("probeDomain / checkDomainRouting", () => {
  const ok = (id: string) => async () => ({ status: 200, text: async () => JSON.stringify({ domainId: id }) });

  it("accepts only the matching domain id", async () => {
    expect((await probeDomain("a.com", "id-1", ok("id-1"))).ok).toBe(true);
    expect(await probeDomain("a.com", "id-1", ok("id-2"))).toEqual({ ok: false, reason: "wrong_store" });
  });
  it("fails on non-200, redirects, junk and network errors", async () => {
    expect((await probeDomain("a.com", "x", async () => ({ status: 301, text: async () => "" }))).reason).toBe("http_301");
    expect((await probeDomain("a.com", "x", async () => ({ status: 200, text: async () => "<html>" }))).ok).toBe(false);
    expect((await probeDomain("a.com", "x", async () => { throw new Error("ECONNREFUSED"); })).reason).toBe("unreachable");
    expect((await probeDomain("a.com", "x", async () => { throw new Error("The operation was aborted due to timeout"); })).reason).toBe("timeout");
  });
  it("does not make any request when DNS does not pass", async () => {
    let called = false;
    const res = await checkDomainRouting("a.com", "id-1", {
      resolver: resolver({}),
      targets,
      fetchImpl: async () => {
        called = true;
        return { status: 200, text: async () => "{}" };
      },
    });
    expect(res.status).toBe("dns_missing");
    expect(called).toBe(false);
  });
  it("reachable when DNS and probe both pass", async () => {
    const res = await checkDomainRouting("a.com", "id-1", { resolver: resolver({ a: ["104.21.59.175"] }), targets, fetchImpl: ok("id-1") });
    expect(res.status).toBe("reachable");
    expect(res.detail.probe).toBe("ok");
  });
});

describe("toRoutingView", () => {
  it("maps a row with no check yet to 'unknown' and carries the expected records", () => {
    const v = toRoutingView({ routingStatus: null, routingDetail: null, routingCheckedAt: null }, targets);
    expect(v.status).toBe("unknown");
    expect(v.expected.a).toEqual(targets.a);
    expect(v.checkedAt).toBeNull();
  });
});
