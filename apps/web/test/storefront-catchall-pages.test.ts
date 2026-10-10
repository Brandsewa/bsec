import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("server-only", () => ({}));

const req = { host: "demo.bcom.si" };

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: req.host }),
}));

const redirects: string[] = [];
const notFoundCalls: number[] = [];

vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => {
    redirects.push(url);
    const err = Object.assign(new Error(`REDIRECT_308:${url}`), {
      digest: `NEXT_REDIRECT;replace;${url};308;`,
    });
    throw err;
  },
  notFound: () => {
    notFoundCalls.push(1);
    const err = Object.assign(new Error("NEXT_NOT_FOUND"), {
      digest: "NEXT_NOT_FOUND",
    });
    throw err;
  },
}));

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
}));

const mockPageData = {
  page: {
    id: "018f97b6-1234-7000-8000-000000000099",
    slug: "about",
    title: "About Our Company",
    type: "custom",
    seo: { title: "SEO Title", description: "SEO Description" },
    publishedAt: "2026-10-09T00:00:00Z",
    document: {
      version: 1 as const,
      blocks: [
        {
          id: "b1",
          type: "Hero" as const,
          version: 1,
          props: { title: "About Hero Headline" },
        },
      ],
    },
  },
  canonicalPath: "/pages/company/about",
  isCanonical: true,
  breadcrumbs: [
    { name: "Home", url: "/" },
    { name: "Company", url: "/pages/company" },
    { name: "About Our Company", url: "/pages/company/about" },
  ],
  renderData: {},
};

let pageDataToReturn: unknown = mockPageData;
let mockMediaUrlToReturn: string | undefined = undefined;

vi.mock("@/server/cached-storefront.ts", () => ({
  getCachedStorefrontPageByPath: vi.fn(async () => pageDataToReturn),
}));

vi.mock("@/server/runtime.ts", () => ({
  server: () => ({
    rt: { service: "web" },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }),
}));

vi.mock("@bs/domain", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    evaluateStorefrontAccess: vi.fn(async () => ({
      tenantId: "tenant-1",
      mode: "live",
      allowed: true,
    })),
    getStorefrontPageByPath: vi.fn(async () => pageDataToReturn),
    resolveMediaUrlById: vi.fn(async (_rt, _tenantId, mediaId) => {
      if (mediaId === "deleted-media-id") return undefined;
      return mockMediaUrlToReturn;
    }),
  };
});

import CustomContentPage, { generateMetadata } from "../src/app/pages/[...path]/page.tsx";

describe("Catch-all Storefront Page ([...path]/page.tsx)", () => {
  beforeEach(() => {
    redirects.length = 0;
    notFoundCalls.length = 0;
    pageDataToReturn = { ...mockPageData, isCanonical: true };
  });

  it("renders page title, JSON-LD breadcrumbs, and blocks on canonical path", async () => {
    const el = await CustomContentPage({
      params: Promise.resolve({ path: ["company", "about"] }),
    });

    const html = renderToString(el);
    expect(html).toContain("About Our Company");
    expect(html).toContain("About Hero Headline");
    expect(html).toContain('application/ld+json');
    expect(html).toContain("BreadcrumbList");
    expect(html).toContain("https://demo.bcom.si/pages/company/about");
  });

  it("issues 308 permanent redirect when accessed via non-canonical ancestor path", async () => {
    pageDataToReturn = {
      ...mockPageData,
      isCanonical: false,
      canonicalPath: "/pages/company/about",
    };

    await expect(
      CustomContentPage({
        params: Promise.resolve({ path: ["about"] }),
      }),
    ).rejects.toThrow("REDIRECT_308:/pages/company/about");

    expect(redirects).toContain("/pages/company/about");
  });

  it("calls notFound() when page is not found or empty path", async () => {
    pageDataToReturn = null;

    await expect(
      CustomContentPage({
        params: Promise.resolve({ path: ["non-existent-page"] }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFoundCalls.length).toBeGreaterThan(0);
  });

  it("generates metadata with canonical URL and SEO attributes", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ path: ["company", "about"] }),
    });

    expect(meta.title).toBe("SEO Title");
    expect(meta.description).toBe("SEO Description");
    expect(meta.alternates?.canonical).toBe("https://demo.bcom.si/pages/company/about");
  });

  it("generates metadata with openGraph and twitter images when imageMediaId is present", async () => {
    mockMediaUrlToReturn = "https://demo.bcom.si/media/about-share.jpg";
    pageDataToReturn = {
      ...mockPageData,
      page: {
        ...mockPageData.page,
        seo: {
          title: "SEO Title",
          description: "SEO Description",
          imageMediaId: "media-uuid-123",
        },
      },
    };

    const meta = await generateMetadata({
      params: Promise.resolve({ path: ["company", "about"] }),
    });

    expect(meta.openGraph?.images).toEqual([
      { url: "https://demo.bcom.si/media/about-share.jpg", alt: "SEO Title" },
    ]);
    expect(meta.twitter).toEqual({
      card: "summary_large_image",
      title: "SEO Title",
      description: "SEO Description",
      images: ["https://demo.bcom.si/media/about-share.jpg"],
    });
  });

  it("generates metadata without images when page has no imageMediaId", async () => {
    mockMediaUrlToReturn = undefined;
    pageDataToReturn = {
      ...mockPageData,
      page: {
        ...mockPageData.page,
        seo: {
          title: "SEO Title",
          description: "SEO Description",
        },
      },
    };

    const meta = await generateMetadata({
      params: Promise.resolve({ path: ["company", "about"] }),
    });

    expect(meta.openGraph?.images).toBeUndefined();
    expect(meta.twitter).toBeUndefined();
  });

  it("generates metadata gracefully without images when imageMediaId is deleted or cannot be resolved", async () => {
    mockMediaUrlToReturn = undefined;
    pageDataToReturn = {
      ...mockPageData,
      page: {
        ...mockPageData.page,
        seo: {
          title: "SEO Title",
          description: "SEO Description",
          imageMediaId: "deleted-media-id",
        },
      },
    };

    const meta = await generateMetadata({
      params: Promise.resolve({ path: ["company", "about"] }),
    });

    expect(meta.title).toBe("SEO Title");
    expect(meta.openGraph?.images).toBeUndefined();
    expect(meta.twitter).toBeUndefined();
  });
});

