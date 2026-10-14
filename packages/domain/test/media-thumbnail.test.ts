import { afterEach, describe, expect, it } from "vitest";
import { buildThumbnailUrl } from "../src/media-services.ts";

const saved = process.env.CDN_BASE_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.CDN_BASE_URL;
  else process.env.CDN_BASE_URL = saved;
});

const img = { kind: "image", storageKey: "t1/products/a.png" };
const url = "https://media.example.test/t1/products/a.png";

describe("buildThumbnailUrl", () => {
  it("uses the original public url when no CDN transform base is configured", () => {
    delete process.env.CDN_BASE_URL;
    expect(buildThumbnailUrl(img, url)).toBe(url);
  });

  it("ignores a blank CDN_BASE_URL", () => {
    process.env.CDN_BASE_URL = "  ";
    expect(buildThumbnailUrl(img, url)).toBe(url);
  });

  it("uses Cloudflare Image Transformations only when CDN_BASE_URL is set", () => {
    process.env.CDN_BASE_URL = "https://cdn.example.test/";
    expect(buildThumbnailUrl(img, url)).toBe(
      "https://cdn.example.test/cdn-cgi/image/width=320,fit=cover,format=auto/t1/products/a.png",
    );
  });

  it("gives videos and documents no thumbnail", () => {
    expect(buildThumbnailUrl({ kind: "video", storageKey: "t1/products/a.mp4" }, url)).toBeNull();
    expect(buildThumbnailUrl({ kind: "document", storageKey: "t1/products/a.pdf" }, url)).toBeNull();
  });
});
