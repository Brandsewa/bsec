import { describe, expect, it } from "vitest";
import { collectMediaIds } from "../src/media.ts";
import { BLOCK_DEFINITIONS, BLOCK_TYPES } from "../src/registry.ts";

const SAMPLE_UUID_1 = "0199a000-0000-7000-8000-000000000001";
const SAMPLE_UUID_2 = "0199a000-0000-7000-8000-000000000002";
const SAMPLE_UUID_3 = "0199a000-0000-7000-8000-000000000003";
const SAMPLE_UUID_4 = "0199a000-0000-7000-8000-000000000004";

describe("Media Extractor (collectMediaIds)", () => {
  it("handles null, undefined, primitives, and junk input safely", () => {
    expect(collectMediaIds(null)).toEqual({ images: [], videos: [], files: [], all: [] });
    expect(collectMediaIds(undefined)).toEqual({ images: [], videos: [], files: [], all: [] });
    expect(collectMediaIds("random-string")).toEqual({ images: [], videos: [], files: [], all: [] });
    expect(collectMediaIds(12345)).toEqual({ images: [], videos: [], files: [], all: [] });
    expect(collectMediaIds({})).toEqual({ images: [], videos: [], files: [], all: [] });
    expect(collectMediaIds([])).toEqual({ images: [], videos: [], files: [], all: [] });
    expect(collectMediaIds({ foo: "bar", nested: { baz: 123 } })).toEqual({
      images: [],
      videos: [],
      files: [],
      all: [],
    });
  });

  it("extracts UUIDs from single mediaId, *MediaId, and mediaIds fields", () => {
    const doc = {
      hero: {
        backgroundMediaId: SAMPLE_UUID_1,
      },
      image: {
        mediaId: SAMPLE_UUID_2,
      },
      list: {
        mediaIds: [SAMPLE_UUID_3, SAMPLE_UUID_4],
      },
    };

    const res = collectMediaIds(doc);
    expect(res.all).toHaveLength(4);
    expect(res.all).toContain(SAMPLE_UUID_1);
    expect(res.all).toContain(SAMPLE_UUID_2);
    expect(res.all).toContain(SAMPLE_UUID_3);
    expect(res.all).toContain(SAMPLE_UUID_4);
    expect(res.images).toHaveLength(4);
  });

  it("strictly ignores non-media keys and non-UUID values", () => {
    const doc = {
      url: "https://example.com/video.mp4",
      bgVideoUrl: "https://example.com/hero.mp4",
      href: "/collections/all",
      backgroundMediaId: "", // empty string
      avatarMediaId: "not-a-uuid-string",
      mediaId: "12345",
      logoMediaId: null,
    };

    const res = collectMediaIds(doc);
    expect(res.all).toEqual([]);
    expect(res.images).toEqual([]);
    expect(res.videos).toEqual([]);
    expect(res.files).toEqual([]);
  });

  it("deduplicates IDs across multiple blocks and occurrences", () => {
    const doc = {
      block1: { backgroundMediaId: SAMPLE_UUID_1 },
      block2: { mediaId: SAMPLE_UUID_1 },
      block3: { mediaIds: [SAMPLE_UUID_1, SAMPLE_UUID_1] },
      block4: { gallery: [{ mediaId: SAMPLE_UUID_1 }] },
    };

    const res = collectMediaIds(doc);
    expect(res.all).toEqual([SAMPLE_UUID_1]);
    expect(res.images).toEqual([SAMPLE_UUID_1]);
  });

  it("extracts gallery items and array-of-objects media references", () => {
    const doc = {
      version: 1,
      blocks: [
        {
          id: "gallery-1",
          type: "Gallery",
          props: {
            images: [
              { mediaId: SAMPLE_UUID_1, caption: "First photo" },
              { mediaId: SAMPLE_UUID_2, caption: "Second photo" },
              { mediaId: "invalid-uuid", caption: "Skipped" },
            ],
          },
        },
      ],
    };

    const res = collectMediaIds(doc);
    expect(res.all).toEqual([SAMPLE_UUID_1, SAMPLE_UUID_2]);
    expect(res.images).toEqual([SAMPLE_UUID_1, SAMPLE_UUID_2]);
    expect(res.videos).toEqual([]);
    expect(res.files).toEqual([]);
  });

  it("extracts nested layout slots, containers, and header/footer blocks", () => {
    const doc = {
      version: 1,
      blocks: [
        {
          id: "header-1",
          type: "SiteHeader",
          props: {
            logoMediaId: SAMPLE_UUID_1,
          },
        },
        {
          id: "container-1",
          type: "Container",
          props: {
            backgroundMediaId: SAMPLE_UUID_2,
          },
          slots: {
            default: [
              {
                id: "testimonials-1",
                type: "Testimonials",
                props: {
                  items: [
                    {
                      author: "Test Person",
                      avatarMediaId: SAMPLE_UUID_3,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    };

    const res = collectMediaIds(doc);
    expect(res.all).toEqual([SAMPLE_UUID_1, SAMPLE_UUID_2, SAMPLE_UUID_3]);
    expect(res.images).toEqual([SAMPLE_UUID_1, SAMPLE_UUID_2, SAMPLE_UUID_3]);
  });

  it("classifies video and file blocks accurately", () => {
    const doc = {
      version: 1,
      blocks: [
        {
          id: "vid-1",
          type: "Video",
          props: {
            mediaId: SAMPLE_UUID_1,
            posterMediaId: SAMPLE_UUID_2,
          },
        },
        {
          id: "file-1",
          type: "FileDownload",
          props: {
            mediaId: SAMPLE_UUID_3,
          },
        },
        {
          id: "hero-1",
          type: "Hero",
          props: {
            backgroundMediaId: SAMPLE_UUID_4,
          },
        },
      ],
    };

    const res = collectMediaIds(doc);
    expect(res.videos).toEqual([SAMPLE_UUID_1]);
    expect(res.images).toContain(SAMPLE_UUID_2);
    expect(res.images).toContain(SAMPLE_UUID_4);
    expect(res.files).toEqual([SAMPLE_UUID_3]);
    expect(res.all).toEqual([SAMPLE_UUID_1, SAMPLE_UUID_2, SAMPLE_UUID_3, SAMPLE_UUID_4]);
  });

  it("handles circular references gracefully without stack overflow", () => {
    const circularDoc: Record<string, unknown> = {
      mediaId: SAMPLE_UUID_1,
    };
    circularDoc.self = circularDoc;

    const res = collectMediaIds(circularDoc);
    expect(res.all).toEqual([SAMPLE_UUID_1]);
  });

  // Guard test: iterates every block schema in the registry, builds a document with a UUID in every
  // field whose key contains "media" (case-insensitive), and asserts the extractor finds them all.
  describe("Registry Guard Test", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function unwrapZod(schema: any): any {
      let curr = schema;
      while (curr) {
        if (typeof curr.unwrap === "function") {
          curr = curr.unwrap();
        } else if (typeof curr.removeDefault === "function") {
          curr = curr.removeDefault();
        } else if (typeof curr.innerType === "function") {
          curr = curr.innerType();
        } else if (curr.schema && typeof curr.schema === "object") {
          curr = curr.schema;
        } else if (curr.def?.innerType) {
          curr = curr.def.innerType;
        } else {
          break;
        }
      }
      return curr;
    }

    it("extracts every media field across all registered block schemas", () => {
      const generatedUuids: string[] = [];
      const testBlocks: Array<{ id: string; type: string; props: Record<string, unknown> }> = [];

      let uuidCounter = 100;
      const nextUuid = () => {
        const hex = (uuidCounter++).toString(16).padStart(12, "0");
        return `0199a000-0000-7000-8000-${hex}`;
      };

      for (const type of BLOCK_TYPES) {
        const def = BLOCK_DEFINITIONS[type];
        const unwrapped = unwrapZod(def.schema);
        const shape = unwrapped?.shape ?? unwrapped?.def?.shape;

        if (shape && typeof shape === "object") {
          const mockProps: Record<string, unknown> = {};

          for (const [key, fieldSchema] of Object.entries(shape)) {
            const innerField = unwrapZod(fieldSchema);

            if (key.toLowerCase().includes("media")) {
              const id = nextUuid();
              generatedUuids.push(id);
              mockProps[key] = id;
            } else {
              // Check if field was an array of objects (like Gallery images, Testimonials items, HeroSlider slides)
              const subShape = innerField?.shape ?? innerField?.def?.shape;
              if (subShape && typeof subShape === "object") {
                const elementProps: Record<string, unknown> = {};
                let foundMediaInArray = false;

                for (const [subKey] of Object.entries(subShape)) {
                  if (subKey.toLowerCase().includes("media")) {
                    const id = nextUuid();
                    generatedUuids.push(id);
                    elementProps[subKey] = id;
                    foundMediaInArray = true;
                  }
                }

                if (foundMediaInArray) {
                  mockProps[key] = [elementProps];
                }
              }
            }
          }

          if (Object.keys(mockProps).length > 0) {
            testBlocks.push({
              id: `test-${type}`,
              type,
              props: mockProps,
            });
          }
        }
      }

      // Assert that we found media fields in the schemas (sanity check)
      expect(generatedUuids.length).toBeGreaterThanOrEqual(8);

      const testDoc = {
        version: 1,
        blocks: testBlocks,
      };

      const extracted = collectMediaIds(testDoc);

      for (const expectedUuid of generatedUuids) {
        expect(
          extracted.all,
          `Expected collectMediaIds to find media UUID ${expectedUuid} from registered schemas`,
        ).toContain(expectedUuid);
      }

      expect(extracted.all.length).toBe(generatedUuids.length);
    });
  });
});
