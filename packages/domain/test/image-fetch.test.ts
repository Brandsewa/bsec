import { describe, expect, it } from "vitest";
import { fetchImageSafely, pinnedLookup, type Resolver, type Transport } from "../src/catalog/bulk-io/image-fetch.ts";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
async function* body(...chunks: Uint8Array[]) {
  for (const c of chunks) yield c;
}
const ok = (data: Uint8Array = PNG, headers: Record<string, string> = {}): Awaited<ReturnType<Transport>> => ({ status: 200, headers, body: body(data), destroy: () => {} });
const publicDns: Resolver = async () => ["93.184.216.34"];

describe("fetchImageSafely", () => {
  it("downloads a real image, pins the checked address and names the file from the URL", async () => {
    let pinned = "";
    const img = await fetchImageSafely("https://cdn.example.com/photos/Blue%20Tee.JPG?v=1", {
      resolve: publicDns,
      transport: async (_u, ip) => {
        pinned = ip;
        return ok();
      },
    });
    expect(pinned).toBe("93.184.216.34");
    expect(img.mime).toBe("image/png");
    expect(img.filename).toBe("Blue-Tee.png");
  });

  it.each([
    ["a private DNS answer", "https://evil.example.com/a.png", async () => ["10.0.0.5"]],
    ["a mixed public and private answer", "https://evil.example.com/a.png", async () => ["93.184.216.34", "127.0.0.1"]],
    ["the metadata address", "https://169.254.169.254/a.png", publicDns],
    ["plain http", "http://cdn.example.com/a.png", publicDns],
  ])("refuses %s", async (_n, url, resolve) => {
    let called = false;
    await expect(fetchImageSafely(url, { resolve, transport: async () => ((called = true), ok()) })).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("re-checks every redirect hop", async () => {
    const hops = ["https://cdn.example.com/a.png", "https://other.example.com/b.png"];
    let n = 0;
    const resolve: Resolver = async (h) => (h === "other.example.com" ? ["192.168.1.9"] : ["93.184.216.34"]);
    const transport: Transport = async () => ({ status: 302, headers: { location: hops[1]! }, body: body(), destroy: () => {} });
    n++;
    await expect(fetchImageSafely(hops[0]!, { resolve, transport })).rejects.toThrow(/private/);
    expect(n).toBe(1);
  });

  it("follows at most 3 redirects", async () => {
    const transport: Transport = async () => ({ status: 301, headers: { location: "https://cdn.example.com/loop.png" }, body: body(), destroy: () => {} });
    await expect(fetchImageSafely("https://cdn.example.com/a.png", { resolve: publicDns, transport })).rejects.toThrow(/redirects/);
  });

  it("rejects non-images, errors and oversize bodies", async () => {
    await expect(fetchImageSafely("https://cdn.example.com/a.png", { resolve: publicDns, transport: async () => ok(new TextEncoder().encode("<html>nope</html>")) })).rejects.toThrow(/not a JPEG/);
    await expect(fetchImageSafely("https://cdn.example.com/a.png", { resolve: publicDns, transport: async () => ({ status: 404, headers: {}, body: body(), destroy: () => {} }) })).rejects.toThrow(/404/);
    await expect(fetchImageSafely("https://cdn.example.com/a.png", { resolve: publicDns, transport: async () => ok(PNG, { "content-length": String(50 * 1024 * 1024) }) })).rejects.toThrow(/10 MB/);
    const big = new Uint8Array(6 * 1024 * 1024);
    await expect(fetchImageSafely("https://cdn.example.com/a.png", { resolve: publicDns, transport: async () => ({ status: 200, headers: {}, body: body(big, big), destroy: () => {} }) })).rejects.toThrow(/10 MB/);
  });

  it("turns a DNS failure into a readable error", async () => {
    await expect(fetchImageSafely("https://nope.example.com/a.png", { resolve: async () => { throw new Error("ENOTFOUND"); }, transport: async () => ok() })).rejects.toThrow(/could not be found/);
  });
});

describe("pinnedLookup", () => {
  it("answers with a list when Node asks for all addresses, and a single address otherwise", () => {
    const out: unknown[] = [];
    pinnedLookup("93.184.216.34")("example.com", { all: true }, (e, a, f) => out.push([e, a, f]));
    pinnedLookup("2606:4700::1111")("example.com", {}, (e, a, f) => out.push([e, a, f]));
    expect(out).toEqual([[null, [{ address: "93.184.216.34", family: 4 }], undefined], [null, "2606:4700::1111", 6]]);
  });
});
