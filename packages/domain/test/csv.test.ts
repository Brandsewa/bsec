import { describe, it, expect } from "vitest";
import {
  parseProductCsv,
  serializeProductCsv,
  type ProductCsvRow,
} from "../src/catalog/csv.ts";

describe("Product CSV Import / Export", () => {
  const sampleRows: ProductCsvRow[] = [
    {
      title: "Handmade Ceramic Mug",
      slug: "handmade-ceramic-mug",
      price: 49900, // ₹499.00 in minor units
      sku: "MUG-001",
      stock: 25,
      category: "Kitchenware",
    },
    {
      title: "Linen Apron, Classic Navy",
      slug: "linen-apron-classic-navy",
      price: 129900, // ₹1,299.00
      sku: "APR-NAVY-01",
      stock: 10,
      category: "Apparel",
    },
  ];

  it("serializes products into CSV format with RFC 4180 quoting", () => {
    const csv = serializeProductCsv(sampleRows);
    expect(csv).toContain("title,slug,price,sku,stock,category");
    expect(csv).toContain("Handmade Ceramic Mug,handmade-ceramic-mug,499.00,MUG-001,25,Kitchenware");
    // "Linen Apron, Classic Navy" has a comma, so it must be enclosed in quotes
    expect(csv).toContain('"Linen Apron, Classic Navy",linen-apron-classic-navy,1299.00,APR-NAVY-01,10,Apparel');
  });

  it("parses valid CSV content into typed product rows", () => {
    const csv = `title,slug,price,sku,stock,category
Handmade Ceramic Mug,handmade-ceramic-mug,499.00,MUG-001,25,Kitchenware
"Linen Apron, Classic Navy",linen-apron-classic-navy,1299.00,APR-NAVY-01,10,Apparel`;

    const result = parseProductCsv(csv);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(sampleRows[0]);
    expect(result.rows[1]).toEqual(sampleRows[1]);
  });

  it("performs a lossless roundtrip (serialize -> parse)", () => {
    const csv = serializeProductCsv(sampleRows);
    const parsed = parseProductCsv(csv);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rows).toEqual(sampleRows);
  });

  it("handles integer prices and formats correctly", () => {
    const csv = `title,slug,price,sku,stock,category
Simple Bowl,simple-bowl,250,BWL-01,5,Tableware`;

    const result = parseProductCsv(csv);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]?.price).toBe(25000); // ₹250.00
  });

  it("reports line errors for missing required fields", () => {
    const invalidCsv = `title,slug,price,sku,stock,category
,missing-title,100.00,SKU-01,10,Cat
Valid Item,valid-item,-50,SKU-02,5,Cat
Another Item,another-item,200.00,,5,Cat
Invalid Stock,invalid-stock,200.00,SKU-04,not-a-number,Cat`;

    const result = parseProductCsv(invalidCsv);
    expect(result.rows).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
    expect(result.errors.some((e) => e.line === 2 && e.message.includes("title"))).toBe(true);
    expect(result.errors.some((e) => e.line === 3 && e.message.includes("price"))).toBe(true);
    expect(result.errors.some((e) => e.line === 4 && e.message.includes("sku"))).toBe(true);
    expect(result.errors.some((e) => e.line === 5 && e.message.includes("stock"))).toBe(true);
  });

  it("fails when required columns are missing in header", () => {
    const badHeader = `title,price,stock\nItem,10.00,5`;
    const result = parseProductCsv(badHeader);
    expect(result.errors.some((e) => e.line === 1 && e.message.includes("Missing required header"))).toBe(true);
  });
});
