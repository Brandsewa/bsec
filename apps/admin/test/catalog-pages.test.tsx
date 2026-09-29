import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const PID = "0199a000-0000-7000-8000-0000000000a1";
const VID = "0199a000-0000-7000-8000-0000000000b1";
const LID = "0199a000-0000-7000-8000-0000000000c1";
const NOW = "2026-09-29T10:00:00.000Z";

const SAMPLE_TEXT = ["Organic Cotton T-Shirt", "Ceramic Coffee Mug", "TSHIRT-BLK-S", "Acme", "Kathmandu", "Nepal"];

function render(client: QueryClient, el: React.ReactElement) {
  return renderToString(React.createElement(QueryClientProvider, { client }, el));
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const product = {
  id: PID,
  title: "Handloom Linen Kurta",
  slug: "handloom-linen-kurta",
  status: "active" as const,
  tags: ["linen"],
  requiresShipping: true,
  isFeatured: false,
  ratingAvg: "0",
  ratingCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
  productType: "Apparel",
};

describe("Catalog pages render real query data", () => {
  it("products list shows seeded rows and no sample data", async () => {
    const { ProductsPage, PRODUCTS_PAGE_SIZE } = await import("../src/routes/_store/products/index.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(
      orpc.admin.products.list.queryOptions({
        input: { search: undefined, status: undefined, limit: PRODUCTS_PAGE_SIZE, offset: 0 },
      }).queryKey,
      { items: [product], total: 1 },
    );
    const html = render(qc, React.createElement(ProductsPage));
    expect(html).toContain("Handloom Linen Kurta");
    expect(html).toContain("handloom-linen-kurta");
    for (const s of SAMPLE_TEXT) expect(html).not.toContain(s);
  });

  it("products list renders the empty state with a call to action", async () => {
    const { ProductsPage, PRODUCTS_PAGE_SIZE } = await import("../src/routes/_store/products/index.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(
      orpc.admin.products.list.queryOptions({
        input: { search: undefined, status: undefined, limit: PRODUCTS_PAGE_SIZE, offset: 0 },
      }).queryKey,
      { items: [], total: 0 },
    );
    const html = render(qc, React.createElement(ProductsPage));
    expect(html).toContain("No products yet");
    expect(html).toContain("Add product");
  });

  it("product detail shows seeded product, variants and price", async () => {
    const { ProductDetailPage } = await import("../src/routes/_store/products/$id.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(orpc.admin.products.get.queryOptions({ input: { id: PID } }).queryKey, {
      ...product,
      options: [],
      media: [],
      variants: [
        {
          id: VID,
          productId: PID,
          sku: "KURTA-LIN-M",
          title: "Medium",
          price: 249900,
          trackInventory: true,
          allowBackorder: false,
          position: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    const html = render(qc, React.createElement(ProductDetailPage, { id: PID }));
    expect(html).toContain("Handloom Linen Kurta");
    expect(html).toContain("KURTA-LIN-M");
    expect(html).toContain("No images attached");
    for (const s of SAMPLE_TEXT) expect(html).not.toContain(s);
  });

  it("new product form renders empty (no prefilled sample data)", async () => {
    const { NewProductPage } = await import("../src/routes/_store/products/new.tsx");
    const html = render(newClient(), React.createElement(NewProductPage));
    expect(html).toContain("Add Product");
    for (const s of SAMPLE_TEXT) expect(html).not.toContain(s);
  });

  it("inventory shows seeded levels and no sample data", async () => {
    const { InventoryPage, INVENTORY_PAGE_SIZE } = await import("../src/routes/_store/inventory/index.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(
      orpc.admin.inventory.list.queryOptions({
        input: { search: undefined, limit: INVENTORY_PAGE_SIZE, offset: 0 },
      }).queryKey,
      {
        items: [
          {
            id: "0199a000-0000-7000-8000-0000000000d1",
            variantId: VID,
            locationId: LID,
            onHand: 37,
            reserved: 3,
            available: 34,
            variantSku: "KURTA-LIN-M",
            variantTitle: "Medium",
            productTitle: "Handloom Linen Kurta",
            locationName: "Bengaluru Hub",
          },
        ],
        total: 1,
      },
    );
    const html = render(qc, React.createElement(InventoryPage));
    expect(html).toContain("Handloom Linen Kurta");
    expect(html).toContain("Bengaluru Hub");
    expect(html).toContain("KURTA-LIN-M");
    for (const s of SAMPLE_TEXT) expect(html).not.toContain(s);
  });

  it("inventory renders the empty state when there are no levels", async () => {
    const { InventoryPage, INVENTORY_PAGE_SIZE } = await import("../src/routes/_store/inventory/index.tsx");
    const { orpc } = await import("../src/lib/orpc.ts");
    const qc = newClient();
    qc.setQueryData(
      orpc.admin.inventory.list.queryOptions({
        input: { search: undefined, limit: INVENTORY_PAGE_SIZE, offset: 0 },
      }).queryKey,
      { items: [], total: 0 },
    );
    const html = render(qc, React.createElement(InventoryPage));
    expect(html).toContain("No inventory yet");
    expect(html).toContain("Add a product");
  });
});
