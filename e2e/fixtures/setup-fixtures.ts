import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = __dirname;

// 1. Valid 1x1 PNG (68 bytes)
export const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// 2. Valid 1x1 JPEG
export const VALID_JPG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

// 3. Valid MP4 with ftyp atom (ISO Base Media File Format)
// Box size 0x20 (32 bytes), type "ftyp", major brand "isom", minor version 0x200, compatible brands "isom", "mp41"
const ftypBox = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x20]), // length: 32
  Buffer.from("ftyp"),
  Buffer.from("isom"), // major brand
  Buffer.from([0x00, 0x00, 0x02, 0x00]), // minor version
  Buffer.from("isom"),
  Buffer.from("mp41"),
  Buffer.from("mp42"),
]);
// moov box placeholder
const moovBox = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x08]),
  Buffer.from("moov"),
]);
export const VALID_MP4 = Buffer.concat([ftypBox, moovBox]);

// 4. Valid PDF document
export const VALID_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 300 300]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000108 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n180\n%%EOF\n",
);

// 5. Valid DOCX (ZIP archive with [Content_Types].xml)
// Minimal valid zip archive
const zipHeader = Buffer.from([
  0x50, 0x4b, 0x03, 0x04, // Local file header signature
  0x0a, 0x00, // Version needed to extract
  0x00, 0x00, // General purpose bit flag
  0x00, 0x00, // Compression method (none)
  0x00, 0x00, // Last mod file time
  0x00, 0x00, // Last mod file date
  0x00, 0x00, 0x00, 0x00, // CRC-32
  0x00, 0x00, 0x00, 0x00, // Compressed size
  0x00, 0x00, 0x00, 0x00, // Uncompressed size
  0x13, 0x00, // File name length (19)
  0x00, 0x00, // Extra field length
]);
const zipFilename = Buffer.from("[Content_Types].xml");
const zipCentralDir = Buffer.from([
  0x50, 0x4b, 0x01, 0x02, // Central directory header
  0x0a, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x13, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
]);
const zipEndCentralDir = Buffer.from([
  0x50, 0x4b, 0x05, 0x06, // End of central dir signature
  0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x31, 0x00, 0x00, 0x00,
  0x31, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
export const VALID_DOCX = Buffer.concat([zipHeader, zipFilename, zipCentralDir, zipFilename, zipEndCentralDir]);

// 6. Rejected SVG
export const REJECTED_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>',
);

export function ensureFixturesExist(): {
  pngPath: string;
  jpgPath: string;
  mp4Path: string;
  pdfPath: string;
  docxPath: string;
  svgPath: string;
  oversizedJpgPath: string;
  oversizedMp4Path: string;
} {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });

  const pngPath = path.join(FIXTURES_DIR, "sample.png");
  const jpgPath = path.join(FIXTURES_DIR, "sample.jpg");
  const mp4Path = path.join(FIXTURES_DIR, "sample.mp4");
  const pdfPath = path.join(FIXTURES_DIR, "sample.pdf");
  const docxPath = path.join(FIXTURES_DIR, "sample.docx");
  const svgPath = path.join(FIXTURES_DIR, "rejected.svg");

  fs.writeFileSync(pngPath, VALID_PNG);
  fs.writeFileSync(jpgPath, VALID_JPG);
  fs.writeFileSync(mp4Path, VALID_MP4);
  fs.writeFileSync(pdfPath, VALID_PDF);
  fs.writeFileSync(docxPath, VALID_DOCX);
  fs.writeFileSync(svgPath, REJECTED_SVG);

  // Oversized 6 MB image for refusal tests (generated dynamically on disk)
  const oversizedJpgPath = path.join(FIXTURES_DIR, "oversized-6mb.jpg");
  if (!fs.existsSync(oversizedJpgPath) || fs.statSync(oversizedJpgPath).size < 6 * 1024 * 1024) {
    const pad = Buffer.alloc(6 * 1024 * 1024 + 1024);
    VALID_JPG.copy(pad, 0);
    fs.writeFileSync(oversizedJpgPath, pad);
  }

  // Oversized 11 MB video for refusal tests (generated dynamically on disk)
  const oversizedMp4Path = path.join(FIXTURES_DIR, "oversized-11mb.mp4");
  if (!fs.existsSync(oversizedMp4Path) || fs.statSync(oversizedMp4Path).size < 11 * 1024 * 1024) {
    const pad = Buffer.alloc(11 * 1024 * 1024 + 1024);
    VALID_MP4.copy(pad, 0);
    fs.writeFileSync(oversizedMp4Path, pad);
  }

  return {
    pngPath,
    jpgPath,
    mp4Path,
    pdfPath,
    docxPath,
    svgPath,
    oversizedJpgPath,
    oversizedMp4Path,
  };
}
