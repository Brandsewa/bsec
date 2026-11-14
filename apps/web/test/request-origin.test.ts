import { describe, expect, it } from "vitest";
import { publicOrigin, publicUrl } from "../src/lib/request-origin.ts";

const h = (o: Record<string, string>) => new Headers(o);

describe("publicOrigin", () => {
  it("uses the forwarded host and protocol, never the server's bind address", () => {
    expect(publicOrigin(h({ "x-forwarded-host": "shop.example.com", "x-forwarded-proto": "https", host: "0.0.0.0:3000" }))).toBe("https://shop.example.com");
  });
  it("takes the first value of a proxy chain", () => {
    expect(publicOrigin(h({ "x-forwarded-host": "shop.example.com, internal", "x-forwarded-proto": "https, http" }))).toBe("https://shop.example.com");
  });
  it("defaults to https for a public host and http for local ones", () => {
    expect(publicOrigin(h({ host: "shop.example.com" }))).toBe("https://shop.example.com");
    expect(publicOrigin(h({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(publicOrigin(h({ host: "0.0.0.0:3000" }))).toBe("http://0.0.0.0:3000");
  });
  it("builds a same-site URL for the thank-you page", () => {
    expect(publicUrl(h({ "x-forwarded-host": "shop.example.com", "x-forwarded-proto": "https" }), "/orders/ord_abc/thank-you").toString()).toBe("https://shop.example.com/orders/ord_abc/thank-you");
  });
});
