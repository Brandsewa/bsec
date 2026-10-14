import { describe, expect, it } from "vitest";
import { sanitizeDownloadFilename } from "../src/media/download.ts";

describe("sanitizeDownloadFilename (Plan S1 / RFC 6266 / RFC 5987)", () => {
  it("strips CR, LF, and null bytes to prevent HTTP response splitting", () => {
    const res = sanitizeDownloadFilename("malicious\r\nSet-Cookie: evil=1\0.pdf");
    expect(res.safeFilename).not.toContain("\r");
    expect(res.safeFilename).not.toContain("\n");
    expect(res.safeFilename).not.toContain("\0");
    expect(res.safeFilename).toBe("maliciousSet-Cookie: evil=1.pdf");
    expect(res.dispositionHeader).toContain('filename="maliciousSet-Cookie: evil=1.pdf"');
  });

  it("replaces path separators / and \\ and collapses traversal sequences", () => {
    const res = sanitizeDownloadFilename("../../../etc/passwd");
    expect(res.safeFilename).not.toContain("/");
    expect(res.safeFilename).not.toContain("\\");
    expect(res.safeFilename).not.toContain("..");
    expect(res.safeFilename).toBe("etc_passwd");
  });

  it("removes double quotes to keep Content-Disposition syntax valid", () => {
    const res = sanitizeDownloadFilename('report-"q3"-final.pdf');
    expect(res.safeFilename).toBe("report-q3-final.pdf");
    expect(res.dispositionHeader).toBe(
      'attachment; filename="report-q3-final.pdf"; filename*=UTF-8\'\'report-q3-final.pdf',
    );
  });

  it("handles Unicode characters with ASCII fallback and RFC 5987 UTF-8 encoding", () => {
    const res = sanitizeDownloadFilename("रिपोर्ट_2026.pdf");
    // safeFilename has non-ASCII replaced for old clients
    expect(res.safeFilename).toContain(".pdf");
    // encodedFilename is percent-encoded UTF-8
    expect(res.encodedFilename).toContain("%E0%A4%B0%E0%A4%BF%E0%A4%AA%E0%A5%8B%E0%A4%B0%E0%A5%8D%E0%A4%9F");
    expect(res.dispositionHeader).toContain("filename*=");
    expect(decodeURIComponent(res.encodedFilename)).toBe("रिपोर्ट_2026.pdf");
  });

  it("falls back to default fallback when filename is empty or only whitespace/dots", () => {
    expect(sanitizeDownloadFilename("").safeFilename).toBe("download");
    expect(sanitizeDownloadFilename(null).safeFilename).toBe("download");
    expect(sanitizeDownloadFilename("   ...   ").safeFilename).toBe("download");
    expect(sanitizeDownloadFilename("", "custom-fallback.bin").safeFilename).toBe("custom-fallback.bin");
  });
});
