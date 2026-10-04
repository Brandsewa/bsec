import { afterEach, describe, expect, it } from "vitest";
import { splitMediaKeysByBucket } from "../src/platform/deletion-steps.ts";
import { getReturnPhotoStorageConfig, isReturnPhotoStorageConfigured } from "../src/orders/return-photos.ts";

describe("return photo storage is separate from the public media bucket", () => {
  const saved = { priv: process.env.R2_PRIVATE_BUCKET_NAME, pub: process.env.R2_BUCKET_NAME };
  afterEach(() => {
    if (saved.priv === undefined) delete process.env.R2_PRIVATE_BUCKET_NAME;
    else process.env.R2_PRIVATE_BUCKET_NAME = saved.priv;
    if (saved.pub === undefined) delete process.env.R2_BUCKET_NAME;
    else process.env.R2_BUCKET_NAME = saved.pub;
  });

  it("is unavailable without a private bucket, and never reuses the public one", () => {
    delete process.env.R2_PRIVATE_BUCKET_NAME;
    expect(getReturnPhotoStorageConfig()).toBeNull();
    expect(isReturnPhotoStorageConfigured()).toBe(false);

    process.env.R2_BUCKET_NAME = "media-public";
    process.env.R2_PRIVATE_BUCKET_NAME = "media-public";
    expect(getReturnPhotoStorageConfig()).toBeNull();

    process.env.R2_PRIVATE_BUCKET_NAME = "returns-private";
    const cfg = getReturnPhotoStorageConfig();
    expect(cfg?.bucketName).toBe("returns-private");
    expect(cfg?.publicUrl).toBeUndefined();
  });

  it("tenant deletion sends return photo keys to the private bucket and the rest to the public one", () => {
    const keys = ["tenants/t1/products/a.jpg", "tenants/t1/returns/o1/p1.jpg", "tenants/t1/branding/logo.png"];
    expect(splitMediaKeysByBucket(keys, true)).toEqual({
      publicKeys: ["tenants/t1/products/a.jpg", "tenants/t1/branding/logo.png"],
      privateKeys: ["tenants/t1/returns/o1/p1.jpg"],
    });
    // With no private bucket configured, everything is deleted from the public bucket as before.
    expect(splitMediaKeysByBucket(keys, false)).toEqual({ publicKeys: keys, privateKeys: [] });
  });
});
