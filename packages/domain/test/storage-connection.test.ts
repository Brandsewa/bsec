import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it, afterEach } from "vitest";
import {
  LocalStorageDriver,
  resolveSafeLocalPath,
  sniffMimeType,
  type ResolvedStorageConfig,
} from "../src/media/connection.ts";

describe("Storage Connection & Drivers", () => {
  describe("resolveSafeLocalPath (Path traversal protection)", () => {
    const baseDir = path.resolve("./.test-media");

    it("accepts safe relative keys inside base directory", () => {
      const safeKey = "tenant-1/products/image-1.jpg";
      const resolved = resolveSafeLocalPath(baseDir, safeKey);
      expect(resolved).toBe(path.resolve(baseDir, "tenant-1/products/image-1.jpg"));
    });

    it("rejects path traversal attempts with ../", () => {
      expect(() => resolveSafeLocalPath(baseDir, "../etc/passwd")).toThrow(
        /directory traversal rejected/i,
      );
      expect(() => resolveSafeLocalPath(baseDir, "tenant/../../secret.txt")).toThrow(
        /directory traversal rejected/i,
      );
    });

    it("rejects URL-encoded path traversal attempts", () => {
      expect(() => resolveSafeLocalPath(baseDir, "..%2Fetc%2Fpasswd")).toThrow(
        /directory traversal rejected/i,
      );
      expect(() => resolveSafeLocalPath(baseDir, "%2e%2e%2fsecret.txt")).toThrow(
        /directory traversal rejected/i,
      );
    });

    it("rejects null byte injection", () => {
      expect(() => resolveSafeLocalPath(baseDir, "image.png\0.exe")).toThrow(/null byte rejected/i);
    });

    it("rejects empty or non-string keys", () => {
      expect(() => resolveSafeLocalPath(baseDir, "")).toThrow(/invalid storage key/i);
    });
  });

  describe("sniffMimeType (Magic byte sniffing)", () => {
    it("identifies JPEG", () => {
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(sniffMimeType(jpegBytes)).toBe("image/jpeg");
    });

    it("identifies PNG", () => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
      expect(sniffMimeType(pngBytes)).toBe("image/png");
    });

    it("identifies GIF", () => {
      const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]);
      expect(sniffMimeType(gifBytes)).toBe("image/gif");
    });

    it("identifies WebP", () => {
      const webpBytes = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x24, 0x00, 0x00, 0x00, // length
        0x57, 0x45, 0x42, 0x50, // WEBP
      ]);
      expect(sniffMimeType(webpBytes)).toBe("image/webp");
    });

    it("identifies SVG", () => {
      const svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
      const svgBytes = Buffer.from(svgText, "utf8");
      expect(sniffMimeType(svgBytes)).toBe("image/svg+xml");
    });

    it("identifies XML SVG", () => {
      const xmlSvg = '<?xml version="1.0"?><svg viewBox="0 0 100 100"></svg>';
      expect(sniffMimeType(Buffer.from(xmlSvg, "utf8"))).toBe("image/svg+xml");
    });

    it("returns null for unknown or non-image types", () => {
      const textBytes = Buffer.from("Hello world, this is a plain text file.", "utf8");
      expect(sniffMimeType(textBytes)).toBeNull();

      const htmlBytes = Buffer.from("<!DOCTYPE html><html><body><h1>Evil</h1></body></html>", "utf8");
      expect(sniffMimeType(htmlBytes)).toBeNull();

      const exeBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // MZ DOS header
      expect(sniffMimeType(exeBytes)).toBeNull();
    });
  });

  describe("LocalStorageDriver operations", () => {
    const tempDir = path.join(os.tmpdir(), `bsec-storage-test-${Date.now()}`);
    const config: ResolvedStorageConfig = {
      id: "0199a000-0000-7000-8000-000000000001",
      name: "Local Test Driver",
      driver: "local",
      purpose: "public_media",
      isActive: true,
      localDir: tempDir,
    };
    const driver = new LocalStorageDriver(config);

    afterEach(async () => {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // cleanup ignore
      }
    });

    it("presignUpload returns server upload route (no direct presign)", async () => {
      const res = await driver.presignUpload({
        tenantId: "t1",
        folder: "products",
        filename: "test.png",
        mime: "image/png",
        bytes: 1024,
      });

      expect(res.uploadUrl).toBe("/api/admin/media/upload");
      expect(res.method).toBe("POST");
      expect(res.storageKey).toMatch(/^t1\/products\/[a-zA-Z0-9-]+\.png$/);
    });

    it("put, head, and delete write and clean up files on local disk", async () => {
      const key = "t1/products/item.txt";
      const content = Buffer.from("test image bytes");

      await driver.put({ key, body: content, contentType: "text/plain" });

      const headResult = await driver.head(key);
      expect(headResult.exists).toBe(true);
      expect(headResult.size).toBe(content.length);

      await driver.delete(key);

      const afterDelete = await driver.head(key);
      expect(afterDelete.exists).toBe(false);
    });

    it("publicUrl returns /media/... path", () => {
      const url = driver.publicUrl("t1/products/sample.png");
      expect(url).toBe("/media/t1/products/sample.png");
    });

    it("testConnection writes and removes a diagnostic file successfully", async () => {
      const res = await driver.testConnection();
      expect(res.ok).toBe(true);
    });
  });
});
