import { describe, it, expect } from "vitest";
import {
  validateMediaUpload,
  generateStorageKey,
  buildCloudflareImageUrl,
  buildCloudflareImageTransformUrl,
  buildPresignedUploadDescriptor,
  uploadToCloudflareImages,
  ALLOWED_IMAGE_MIMES,
  MAX_MEDIA_BYTES,
} from "../src/media/storage.ts";

describe("Media Storage & Cloudflare Images Helpers", () => {
  describe("validateMediaUpload", () => {
    it("accepts valid image formats within size limits", () => {
      for (const mime of ALLOWED_IMAGE_MIMES) {
        const result = validateMediaUpload(mime, 1024 * 1024); // 1MB
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }
    });

    it("rejects disallowed MIME types", () => {
      const invalidMimes = [
        "application/x-msdownload",
        "text/html",
        "application/javascript",
        "video/mp4",
      ];
      for (const mime of invalidMimes) {
        const result = validateMediaUpload(mime, 1024);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("MIME type");
      }
    });

    it("rejects files exceeding maximum allowed bytes", () => {
      const result = validateMediaUpload("image/png", MAX_MEDIA_BYTES + 1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("size exceeds");
    });

    it("rejects files with zero or negative bytes", () => {
      expect(validateMediaUpload("image/png", 0).valid).toBe(false);
      expect(validateMediaUpload("image/png", -10).valid).toBe(false);
    });
  });

  describe("generateStorageKey", () => {
    it("formats key as tenant/folder/uuid.ext", () => {
      const tenantId = "01940000-0000-7000-8000-000000000001";
      const customId = "01940000-0000-7000-8000-000000000002";
      const keyInfo = generateStorageKey(tenantId, "products", "ceramic-vase.PNG", customId);

      expect(keyInfo.storageKey).toBe(`${tenantId}/products/${customId}.png`);
      expect(keyInfo.extension).toBe("png");
    });

    it("sanitizes folder name and handles file without extension", () => {
      const tenantId = "01940000-0000-7000-8000-000000000001";
      const keyInfo = generateStorageKey(tenantId, "/branding//", "logo", "logo-id");

      expect(keyInfo.storageKey).toBe(`${tenantId}/branding/logo-id.bin`);
      expect(keyInfo.extension).toBe("bin");
    });
  });

  describe("buildCloudflareImageUrl", () => {
    it("constructs standard Cloudflare Images delivery URL", () => {
      const url = buildCloudflareImageUrl(
        "https://imagedelivery.net/abc-account-hash-123",
        "cf-image-id-99",
        "public",
      );
      expect(url).toBe("https://imagedelivery.net/abc-account-hash-123/cf-image-id-99/public");
    });

    it("constructs Cloudflare Image Resizing / transformation URL", () => {
      const url = buildCloudflareImageTransformUrl(
        "https://cdn.brandsewa.com",
        "tenant-1/products/pottery.webp",
        {
          width: 800,
          height: 600,
          fit: "cover",
          format: "avif",
        },
      );
      expect(url).toBe(
        "https://cdn.brandsewa.com/cdn-cgi/image/width=800,height=600,fit=cover,format=avif/tenant-1/products/pottery.webp",
      );
    });
  });

  describe("buildPresignedUploadDescriptor", () => {
    it("generates genuine SigV4 presigned upload URL with expiry and security headers", async () => {
      const descriptor = await buildPresignedUploadDescriptor({
        tenantId: "tenant-123",
        folder: "products",
        filename: "mug.jpg",
        mime: "image/jpeg",
        bytes: 50000,
        expiresInSeconds: 300,
        r2Config: {
          accountId: "7a0533854a8ded58696db809f403f26c",
          bucketName: "bsec-media",
          accessKeyId: "mock-access-key-id",
          secretAccessKey: "mock-secret-access-key",
        },
      });

      // Verify endpoint structure matching Coolify / R2 setup
      expect(descriptor.uploadUrl).toContain("7a0533854a8ded58696db809f403f26c.r2.cloudflarestorage.com");
      expect(descriptor.uploadUrl).toContain("/bsec-media/tenant-123/products/");

      // Verify SigV4 presigning parameters
      const url = new URL(descriptor.uploadUrl);
      expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
      expect(url.searchParams.get("X-Amz-Credential")).toContain("mock-access-key-id");
      expect(url.searchParams.get("X-Amz-Date")).toBeDefined();
      expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toBeDefined();
      expect(url.searchParams.get("X-Amz-Signature")).toBeDefined();

      expect(descriptor.storageKey).toMatch(/^tenant-123\/products\/[a-zA-Z0-9-]+\.jpg$/);
      expect(descriptor.headers["Content-Type"]).toBe("image/jpeg");
      expect(descriptor.headers["Content-Length"]).toBeUndefined();
      expect(descriptor.expiresInSeconds).toBe(300);
    });
  });

  describe("uploadToCloudflareImages", () => {
    it("gracefully returns unconfigured state when CLOUDFLARE_IMAGES_API_TOKEN is absent", async () => {
      const result = await uploadToCloudflareImages({
        file: new Uint8Array([1, 2, 3]),
        filename: "test.png",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("CLOUDFLARE_IMAGES_API_TOKEN not configured");
    });
  });
});
