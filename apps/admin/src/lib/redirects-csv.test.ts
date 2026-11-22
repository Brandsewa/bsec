import { describe, expect, it } from "vitest";
import { parseRedirectsCsv } from "./redirects-csv.ts";

describe("parseRedirectsCsv", () => {
  it("reads two or three columns and skips a header row", () => {
    const r = parseRedirectsCsv("from,to,type\n/old-a,/new-a\n/old-b,/new-b,301\n");
    expect(r.rows).toEqual([{ from: "/old-a", to: "/new-a" }, { from: "/old-b", to: "/new-b", status: "301" }]);
  });

  it("takes a file with no header, semicolons, quotes, a BOM and Windows line endings", () => {
    const r = parseRedirectsCsv('﻿/old;"https://example.com/a,b"\r\n/x;/y;302\r\n');
    expect(r.rows).toEqual([{ from: "/old", to: "https://example.com/a,b" }, { from: "/x", to: "/y", status: "302" }]);
  });

  it("reports an empty file and a line with a missing cell", () => {
    expect(parseRedirectsCsv("  \n").error).toMatch(/empty/);
    expect(parseRedirectsCsv("/a,/b\n/only-one\n").error).toMatch(/Line 2/);
  });
});
