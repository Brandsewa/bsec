import { describe, expect, it } from "vitest";
import { MEDIA_GENERIC_ERROR, merchantMediaError } from "../src/media/errors.ts";

const hidden = (msg: string) => {
  const r = merchantMediaError(new Error(msg));
  expect(r.expose, `should hide: ${msg}`).toBe(false);
  expect(r.message).toBe(MEDIA_GENERIC_ERROR);
};

describe("merchantMediaError", () => {
  it("hides file system, storage and database internals", () => {
    hidden("EACCES: permission denied, mkdir '/data/media/0199b000-0000-7000-8000-000000000001'");
    hidden("ENOENT: no such file or directory, open '/app/apps/web/.data/media/x.png'");
    hidden("ENOSPC: no space left on device, write");
    hidden("Failed to write C:\\Users\\razd\\bsec\\.data\\media\\a.png");
    hidden("AccessDenied: Access Denied");
    hidden("NoSuchBucket: The specified bucket does not exist");
    hidden("getaddrinfo ENOTFOUND abc123.r2.cloudflarestorage.com");
    hidden("connect ECONNREFUSED 127.0.0.1:5432");
    hidden('duplicate key value violates unique constraint "media_tenant_storage_key_uniq"');
    hidden('relation "media" does not exist');
    hidden("Security violation: storageKey \"x\" does not start with tenant prefix \"t/\"");
    hidden("Error at Object.handler (/app/apps/web/.next/server/chunks/a.js:1:7697)");
  });

  it("hides an internal detail even behind a safe-looking prefix", () => {
    hidden("Bad Request: EACCES: permission denied, mkdir '/data/media/t'");
    hidden("Not Found: file /app/data/x");
  });

  it("hides empty and unknown errors", () => {
    expect(merchantMediaError(new Error("")).expose).toBe(false);
    expect(merchantMediaError(null).expose).toBe(false);
    expect(merchantMediaError(new Error("Something odd happened")).expose).toBe(false);
  });

  it("shows validation messages written for merchants, without the status prefix", () => {
    expect(merchantMediaError(new Error("Bad Request: Replacement file must be of the same type (image)"))).toEqual({
      message: "Replacement file must be of the same type (image)",
      expose: true,
    });
    expect(merchantMediaError(new Error("Not Found: media item not found")).message).toBe("media item not found");
    for (const m of [
      "SVG uploads are disabled for security reasons",
      'Unsupported media format: "application/zip"',
      "File content does not match declared type image/png",
      "Failed to process image metadata: corrupted or invalid image file",
      "Uploaded file is empty",
      "Image storage is not set up yet. Ask the platform team to connect it, then try again.",
    ]) {
      const r = merchantMediaError(new Error(m));
      expect(r.expose, m).toBe(true);
      expect(r.message).toBe(m);
    }
  });
});
