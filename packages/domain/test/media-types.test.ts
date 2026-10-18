import { describe, expect, it } from "vitest";
import {
  MEDIA_TYPES,
  getMediaKind,
  isAllowedMime,
  verifyMediaMagicBytes,
} from "../src/media/types.ts";

describe("MEDIA_TYPES definition and magic-byte checks (MEDIA-LIBRARY-PLAN §4)", () => {
  it("defines all supported formats across image, video, and document", () => {
    const images = MEDIA_TYPES.filter((t) => t.kind === "image");
    const videos = MEDIA_TYPES.filter((t) => t.kind === "video");
    const documents = MEDIA_TYPES.filter((t) => t.kind === "document");

    expect(images.map((t) => t.mime)).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
      "image/gif",
    ]);

    expect(videos.map((t) => t.mime)).toEqual([
      "video/mp4",
      "video/webm",
      "video/quicktime",
    ]);

    expect(documents.map((t) => t.mime)).toEqual([
      "application/pdf",
      "text/csv",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]);
  });

  it("identifies kinds correctly and rejects SVG from allowed list", () => {
    expect(isAllowedMime("image/jpeg")).toBe(true);
    expect(getMediaKind("image/jpeg")).toBe("image");
    expect(getMediaKind("video/mp4")).toBe("video");
    expect(getMediaKind("application/pdf")).toBe("document");

    // SVG must be disallowed (Plan D3)
    expect(isAllowedMime("image/svg+xml")).toBe(false);
    expect(getMediaKind("image/svg+xml")).toBeUndefined();
    const svgRes = verifyMediaMagicBytes("image/svg+xml", Buffer.from("<svg></svg>"));
    expect(svgRes.valid).toBe(false);
    expect(svgRes.error).toMatch(/SVG uploads are disabled/i);
  });

  it("verifies JPEG magic bytes (FF D8 FF)", () => {
    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(verifyMediaMagicBytes("image/jpeg", validJpeg)).toEqual({
      valid: true,
      kind: "image",
    });

    const invalid = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(verifyMediaMagicBytes("image/jpeg", invalid).valid).toBe(false);
  });

  it("verifies PNG magic bytes (89 50 4E 47 0D 0A 1A 0A)", () => {
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(verifyMediaMagicBytes("image/png", validPng)).toEqual({
      valid: true,
      kind: "image",
    });
  });

  it("verifies WebP magic bytes (RIFF....WEBP)", () => {
    const validWebp = Buffer.from([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x20, 0x00, 0x00, 0x00, // size
      0x57, 0x45, 0x42, 0x50, // WEBP
      0x56, 0x50, 0x38, 0x20,
    ]);
    expect(verifyMediaMagicBytes("image/webp", validWebp)).toEqual({
      valid: true,
      kind: "image",
    });
  });

  it("verifies AVIF magic bytes (....ftypavif)", () => {
    const validAvif = Buffer.from([
      0x00, 0x00, 0x00, 0x1c, // box size
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x61, 0x76, 0x69, 0x66, // avif
      0x00, 0x00, 0x00, 0x00,
    ]);
    expect(verifyMediaMagicBytes("image/avif", validAvif)).toEqual({
      valid: true,
      kind: "image",
    });
  });

  it("verifies GIF magic bytes (GIF87a / GIF89a)", () => {
    const validGif89 = Buffer.from("GIF89a\x01\x00\x01\x00", "ascii");
    expect(verifyMediaMagicBytes("image/gif", validGif89)).toEqual({
      valid: true,
      kind: "image",
    });
    const validGif87 = Buffer.from("GIF87a\x01\x00\x01\x00", "ascii");
    expect(verifyMediaMagicBytes("image/gif", validGif87)).toEqual({
      valid: true,
      kind: "image",
    });
  });

  it("verifies MP4 magic bytes (....ftyp)", () => {
    const validMp4 = Buffer.from([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x69, 0x73, 0x6f, 0x6d, // isom
      0x00, 0x00, 0x02, 0x00,
    ]);
    expect(verifyMediaMagicBytes("video/mp4", validMp4)).toEqual({
      valid: true,
      kind: "video",
    });
  });

  it("accepts MP4 files that start with a free, wide, moov or mdat box, and still rejects other content", () => {
    const box = (name: string) => Buffer.from([0, 0, 0, 8, ...[...name].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, 0, 0, 0, 0]);
    for (const name of ["free", "skip", "wide", "moov", "mdat"]) {
      expect(verifyMediaMagicBytes("video/mp4", box(name)).valid, name).toBe(true);
    }
    expect(verifyMediaMagicBytes("video/mp4", box("abcd")).valid).toBe(false);
    expect(verifyMediaMagicBytes("video/mp4", Buffer.from("<html><body>not a video</body></html>")).valid).toBe(false);
    expect(verifyMediaMagicBytes("video/mp4", Buffer.from([0, 0, 0, 2, 0x66, 0x72, 0x65, 0x65, 0, 0, 0, 0])).valid).toBe(false);
  });

  it("verifies WebM magic bytes (1A 45 DF A3)", () => {
    const validWebm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
    expect(verifyMediaMagicBytes("video/webm", validWebm)).toEqual({
      valid: true,
      kind: "video",
    });
  });

  it("verifies QuickTime MOV magic bytes", () => {
    const validMov = Buffer.from([
      0x00, 0x00, 0x00, 0x14,
      0x66, 0x74, 0x79, 0x70, // ftyp
      0x71, 0x74, 0x20, 0x20, // qt
    ]);
    expect(verifyMediaMagicBytes("video/quicktime", validMov)).toEqual({
      valid: true,
      kind: "video",
    });
  });

  it("verifies PDF magic bytes (25 50 44 46)", () => {
    const validPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj");
    expect(verifyMediaMagicBytes("application/pdf", validPdf)).toEqual({
      valid: true,
      kind: "document",
    });
  });

  it("verifies text/csv and text/plain (checks for NUL byte rejection)", () => {
    const validCsv = Buffer.from("id,name,price\n1,Widget,100\n");
    expect(verifyMediaMagicBytes("text/csv", validCsv, "export.csv")).toEqual({
      valid: true,
      kind: "document",
    });

    const validTxt = Buffer.from("Hello world plain text");
    expect(verifyMediaMagicBytes("text/plain", validTxt, "readme.txt")).toEqual({
      valid: true,
      kind: "document",
    });

    // CSV containing NUL byte must be rejected
    const csvWithNul = Buffer.from("id,name\x00,price\n");
    expect(verifyMediaMagicBytes("text/csv", csvWithNul, "bad.csv").valid).toBe(false);

    // Mismatched extension
    expect(verifyMediaMagicBytes("text/csv", validCsv, "notes.txt").valid).toBe(false);
  });

  it("verifies DOCX, XLSX, PPTX zip signature (50 4B 03 04) with matching extension", () => {
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);

    // DOCX
    const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(verifyMediaMagicBytes(docxMime, zipHeader, "contract.docx")).toEqual({
      valid: true,
      kind: "document",
    });
    // Reject docx with xlsx extension
    expect(verifyMediaMagicBytes(docxMime, zipHeader, "sheet.xlsx").valid).toBe(false);

    // XLSX
    const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    expect(verifyMediaMagicBytes(xlsxMime, zipHeader, "sheet.xlsx")).toEqual({
      valid: true,
      kind: "document",
    });

    // PPTX
    const pptxMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    expect(verifyMediaMagicBytes(pptxMime, zipHeader, "deck.pptx")).toEqual({
      valid: true,
      kind: "document",
    });
  });

  it("refuses an empty file", () => {
    const emptyBuf = Buffer.alloc(0);
    const res = verifyMediaMagicBytes("image/png", emptyBuf);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/file is empty/i);
  });

  it("refuses a mismatching file (e.g. PDF renamed to .png)", () => {
    const pdfBytes = Buffer.from("%PDF-1.7\n1 0 obj");
    const res = verifyMediaMagicBytes("image/png", pdfBytes, "document.png");
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/does not match declared MIME type/i);
  });

  it("refuses an unsupported MIME type", () => {
    const exeBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ
    const res = verifyMediaMagicBytes("application/x-msdownload", exeBytes, "malware.exe");
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/unsupported MIME type/i);
  });
});
