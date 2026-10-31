import { describe, expect, it } from "vitest";
import { autoMapHeaders } from "../src/catalog/bulk-io/columns.ts";
import { importDescriptionToText, toRichTextHtml } from "../src/catalog/bulk-io/description.ts";
import { checkImageUrl, isBlockedAddress, sniffImageMime } from "../src/catalog/bulk-io/image-guard.ts";
import { parsePriceCell, parseProductRows } from "../src/catalog/bulk-io/parse.ts";

describe("autoMapHeaders", () => {
  it("matches our headers, Shopify headers and custom fields, each field once", () => {
    const map = autoMapHeaders(["Handle", "Title", "Body (HTML)", "Variant SKU", "Variant Price", "Image Src", "Fabric", "Price"], [{ key: "fabric", name: "Fabric" }]);
    expect(map).toEqual(["handle", "title", "description", "sku", "price", "imageUrl", "cf:fabric", null]);
  });
  it("leaves unknown columns unmapped", () => {
    expect(autoMapHeaders(["Whatever"])).toEqual([null]);
  });
});

describe("importDescriptionToText", () => {
  it("keeps structure as text and drops markup and scripts", () => {
    const out = importDescriptionToText('<h2>Care</h2><p>Wash <strong>cold</strong> and <em>dry</em>.</p><ul><li>One</li><li>Two</li></ul><script>alert(1)</script>');
    expect(out).toBe("Care\n\nWash cold and dry.\n\n- One\n- Two");
    expect(out).not.toContain("alert");
  });
  it("leaves plain text alone and collapses blank runs", () => {
    expect(importDescriptionToText("A\n\n\n\nB  ")).toBe("A\n\nB");
  });
});

describe("toRichTextHtml", () => {
  it("keeps HTML for the field sanitiser and builds HTML from light Markdown", () => {
    expect(toRichTextHtml("<p>Hi <b>there</b></p>")).toBe("<p>Hi <b>there</b></p>");
    expect(toRichTextHtml("# Care\n\nWash **cold** & hot\n\n- One\n- Two")).toBe("<h3>Care</h3><p>Wash <strong>cold</strong> &amp; hot</p><ul><li>One</li><li>Two</li></ul>");
  });
});

describe("parsePriceCell", () => {
  it("handles symbols and thousands separators", () => {
    expect(parsePriceCell("₹1,299.50", "INR")).toBe(129950);
    expect(parsePriceCell("499", "INR")).toBe(49900);
  });
  it("rejects junk and negatives", () => {
    expect(parsePriceCell("abc", "INR")).toBeNull();
    expect(parsePriceCell("-5", "INR")).toBeNull();
  });
});

describe("parseProductRows", () => {
  const map = ["handle", "title", "primaryCategory", "option1Name", "option1Value", "sku", "price", "imageUrl", "cf:fabric"];
  it("groups variant and image rows under one product", () => {
    const { products, issues } = parseProductRows(
      [
        ["tee", "Tee", "Tops", "Size", "S", "TEE-S", "499", "https://cdn.example.com/a.jpg", "Cotton"],
        ["tee", "", "", "", "M", "TEE-M", "499", "https://cdn.example.com/b.jpg", ""],
        ["", "", "", "", "", "", "", "https://cdn.example.com/c.jpg", ""],
      ],
      map,
      "INR",
    );
    expect(issues).toEqual([]);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ handle: "tee", title: "Tee", primaryCategory: "Tops", optionNames: ["Size"], customFields: { fabric: "Cotton" } });
    expect(products[0]?.variants.map((v) => [v.sku, v.price])).toEqual([["TEE-S", 49900], ["TEE-M", 49900]]);
    expect(products[0]?.imageUrls).toHaveLength(3);
  });
  it("drops a bad product but keeps the rest", () => {
    const { products, issues } = parseProductRows(
      [
        ["a", "A", "", "", "", "A-1", "oops", "", ""],
        ["b", "B", "", "", "", "B-1", "10", "http://insecure.example.com/x.jpg", ""],
        ["c", "C", "", "", "", "C-1", "10", "", ""],
      ],
      map,
      "INR",
    );
    expect(products.map((p) => p.handle)).toEqual(["c"]);
    expect(issues.map((i) => [i.row, i.handle])).toEqual([[2, "a"], [3, "b"]]);
  });
  it("flags duplicate SKUs inside a product", () => {
    const { products, issues } = parseProductRows(
      [["d", "D", "", "", "", "X", "1", "", ""], ["d", "", "", "", "", "x", "1", "", ""]],
      map,
      "INR",
    );
    expect(products).toEqual([]);
    expect(issues[0]?.error).toMatch(/twice/);
  });
});

describe("image guard", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1",
    "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip",
  ])("blocks %s", (ip) => expect(isBlockedAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isBlockedAddress(ip)).toBe(false));

  it.each([
    "http://example.com/a.jpg", "https://localhost/a.jpg", "https://user:pw@example.com/a.jpg", "https://example.com:8443/a.jpg",
    "https://169.254.169.254/latest", "https://[::1]/a.jpg", "https://db.internal/a.jpg", "ftp://example.com/a.jpg", "javascript:alert(1)", "nope",
  ])("rejects %s", (u) => expect(checkImageUrl(u).ok).toBe(false));
  it("accepts a plain https image URL", () => expect(checkImageUrl("https://cdn.example.com/a.jpg?v=2").ok).toBe(true));

  it("sniffs real types and refuses SVG and HTML", () => {
    expect(sniffImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageMime(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageMime(new TextEncoder().encode("<!doctype html><html>"))).toBeNull();
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(sniffImageMime(webp)).toBe("image/webp");
  });
});
