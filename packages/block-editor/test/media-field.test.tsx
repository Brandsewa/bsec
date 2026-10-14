import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { HostContext, RenderDataContext, type BlockEditorHost } from "../src/context.tsx";
import {
  mediaField,
  videoMediaField,
  fileMediaField,
  galleryMediaField,
  Picker,
  GalleryPicker,
} from "../src/MediaField.tsx";

describe("MediaField components and custom fields", () => {
  it("renders disabled helper state when neither pickMedia nor listMedia is configured", () => {
    const html = renderToString(
      <HostContext.Provider value={null}>
        <RenderDataContext.Provider value={{ data: {}, media: {} }}>
          <Picker label="Background image" value={undefined} onChange={() => {}} />
        </RenderDataContext.Provider>
      </HostContext.Provider>,
    );
    expect(html).toContain("Background image");
    expect(html).toContain("Stores add their own media after activating this theme.");
  });

  it("renders choose button when pickMedia is present on host", () => {
    const host: BlockEditorHost = {
      loadRenderData: vi.fn(),
      pickMedia: vi.fn().mockResolvedValue([]),
    };

    const html = renderToString(
      <HostContext.Provider value={host}>
        <RenderDataContext.Provider value={{ data: {}, media: {} }}>
          <Picker label="Hero banner image" value={undefined} onChange={() => {}} accept={["image"]} />
        </RenderDataContext.Provider>
      </HostContext.Provider>,
    );

    expect(html).toContain("Hero banner image");
    expect(html).toContain("Choose image");
    expect(html).toContain("No image selected");
  });

  it("renders preview and change/remove buttons when value is set and resolved in render data", () => {
    const host: BlockEditorHost = {
      loadRenderData: vi.fn(),
      pickMedia: vi.fn().mockResolvedValue([]),
    };

    const html = renderToString(
      <HostContext.Provider value={host}>
        <RenderDataContext.Provider value={{ data: {}, media: { "media-123": "https://cdn.example.com/pic.jpg" } }}>
          <Picker label="Product image" value="media-123" onChange={() => {}} accept={["image"]} />
        </RenderDataContext.Provider>
      </HostContext.Provider>,
    );

    expect(html).toContain("https://cdn.example.com/pic.jpg");
    expect(html).toContain("Change");
    expect(html).toContain("Remove");
  });

  it("field factories create Puck custom fields with expected types and labels", () => {
    const imgField = mediaField("Test Image");
    expect(imgField.type).toBe("custom");
    expect(imgField.label).toBe("Test Image");

    const vidField = videoMediaField("Promo Video");
    expect(vidField.type).toBe("custom");
    expect(vidField.label).toBe("Promo Video");

    const docField = fileMediaField("Brochure");
    expect(docField.type).toBe("custom");
    expect(docField.label).toBe("Brochure");

    const galField = galleryMediaField("Product Gallery", { max: 5 });
    expect(galField.type).toBe("custom");
    expect(galField.label).toBe("Product Gallery");
  });

  it("renders document indicator when document is selected in fileMediaField", () => {
    const host: BlockEditorHost = {
      loadRenderData: vi.fn(),
      pickMedia: vi.fn().mockResolvedValue([]),
    };

    const html = renderToString(
      <HostContext.Provider value={host}>
        <RenderDataContext.Provider value={{ data: {}, media: { "doc-1": "https://cdn.example.com/spec.pdf" } }}>
          <Picker label="Spec Sheet" value="doc-1" onChange={() => {}} accept={["document"]} />
        </RenderDataContext.Provider>
      </HostContext.Provider>,
    );

    expect(html).toContain("Document selected");
    expect(html).toContain("Change");
  });

  it("renders video element when video is selected in videoMediaField", () => {
    const host: BlockEditorHost = {
      loadRenderData: vi.fn(),
      pickMedia: vi.fn().mockResolvedValue([]),
    };

    const html = renderToString(
      <HostContext.Provider value={host}>
        <RenderDataContext.Provider value={{ data: {}, media: { "vid-1": "https://cdn.example.com/clip.mp4" } }}>
          <Picker label="Background video" value="vid-1" onChange={() => {}} accept={["video"]} />
        </RenderDataContext.Provider>
      </HostContext.Provider>,
    );

    expect(html).toContain("<video");
    expect(html).toContain("src=\"https://cdn.example.com/clip.mp4\"");
  });

  it("GalleryPicker renders selection count or empty state", () => {
    const host: BlockEditorHost = {
      loadRenderData: vi.fn(),
      pickMedia: vi.fn().mockResolvedValue([]),
    };

    const emptyHtml = renderToString(
      <HostContext.Provider value={host}>
        <RenderDataContext.Provider value={{ data: {}, media: {} }}>
          <GalleryPicker label="Gallery" value={[]} onChange={() => {}} />
        </RenderDataContext.Provider>
      </HostContext.Provider>,
    );
    expect(emptyHtml).toContain("No images selected");
    expect(emptyHtml).toContain("Select images");

    const filledHtml = renderToString(
      <HostContext.Provider value={host}>
        <RenderDataContext.Provider value={{ data: {}, media: {} }}>
          <GalleryPicker label="Gallery" value={["img-1", "img-2"]} onChange={() => {}} />
        </RenderDataContext.Provider>
      </HostContext.Provider>,
    );
    expect(filledHtml).toContain("2 images selected");
    expect(filledHtml).toContain("Manage images");
    expect(filledHtml).toContain("Clear");
  });
});
