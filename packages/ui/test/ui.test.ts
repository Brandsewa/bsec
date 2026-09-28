import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { cn } from "../src/lib/cn.ts";
import { TableSkeleton } from "../src/components/skeleton.tsx";
import { PageBreadcrumbs } from "../src/layout/page.tsx";
import type { ColumnDef, DataTableProps } from "../src/patterns/data-table.tsx";

describe("@bs/ui", () => {
  it("cn merges conflicting tailwind classes", () => {
    expect(cn("px-2", false, "px-4")).toBe("px-4");
  });

  it("skeletons are hidden from screen readers", () => {
    const html = renderToStaticMarkup(createElement(TableSkeleton, { rows: 2, columns: 2 }));
    expect(html.startsWith('<div aria-hidden="true"')).toBe(true);
  });

  it("breadcrumbs mark the last item as the current page and link the rest", () => {
    const html = renderToStaticMarkup(
      createElement(PageBreadcrumbs, { items: [{ label: "Orders", href: "/orders" }, { label: "#1001" }] }),
    );
    expect(html).toContain('<a href="/orders"');
    expect(html).toContain('aria-current="page">#1001');
  });

  it("MetricCard renders label, formatted value, and trend change", async () => {
    const { MetricCard } = await import("../src/patterns/metric-card.tsx");
    const html = renderToStaticMarkup(
      createElement(MetricCard, {
        label: "Total Revenue",
        value: "₹1,45,000",
        change: { value: "+12.5%", trend: "up" },
        description: "vs last month",
      }),
    );
    expect(html).toContain("Total Revenue");
    expect(html).toContain("₹1,45,000");
    expect(html).toContain("+12.5%");
    expect(html).toContain("vs last month");
  });

  it("FilterBar renders search input and action slot", async () => {
    const { FilterBar } = await import("../src/patterns/filter-bar.tsx");
    const html = renderToStaticMarkup(
      createElement(FilterBar, {
        search: "shoes",
        searchPlaceholder: "Search products...",
        actions: createElement("button", null, "Export CSV"),
      }),
    );
    expect(html).toContain('value="shoes"');
    expect(html).toContain('placeholder="Search products..."');
    expect(html).toContain("Export CSV");
  });

  it("DataTable renders rows, columns, and handles empty state", async () => {
    const { DataTable } = await import("../src/patterns/data-table.tsx");
    type Row = { id: string; title: string; price: number };
    const testData: Row[] = [
      { id: "1", title: "Product Alpha", price: 1999 },
      { id: "2", title: "Product Beta", price: 2999 },
    ];
    const columns: ColumnDef<Row>[] = [
      { header: "Title", accessorKey: "title" },
      { header: "Price", cell: (item: Row) => `₹${item.price}` },
    ];

    const filledHtml = renderToStaticMarkup(
      createElement<DataTableProps<Row>>(DataTable, {
        data: testData,
        columns,
        keyExtractor: (item: Row) => item.id,
      }),
    );
    expect(filledHtml).toContain("Product Alpha");
    expect(filledHtml).toContain("₹1999");
    expect(filledHtml).toContain("Product Beta");

    const emptyHtml = renderToStaticMarkup(
      createElement<DataTableProps<Row>>(DataTable, {
        data: [],
        columns,
        keyExtractor: (item: Row) => item.id,
        emptyTitle: "No products found",
      }),
    );
    expect(emptyHtml).toContain("No products found");
  });
});
