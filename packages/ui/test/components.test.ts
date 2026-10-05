import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  Button,
  StatusBadge,
  Money,
  Spinner,
  Empty,
  PageHeaderSkeleton,
  MetricCardsSkeleton,
  DataTableSkeleton,
  FormSectionSkeleton,
  DetailPageSkeleton,
  AuthCardSkeleton,
  AccountPageSkeleton,
  SharedDataTable,
  type SharedDataTableProps,
  Pagination,
} from "../src/index.ts";

describe("@bs/ui Part 2 Component Kit Unit Tests", () => {
  it("Button renders with variants, sizes, and loading state", () => {
    const htmlPrimary = renderToStaticMarkup(createElement(Button, { variant: "primary" }, "Save"));
    expect(htmlPrimary).toContain("Save");

    const htmlBrand = renderToStaticMarkup(createElement(Button, { variant: "brand" }, "Mint Action"));
    expect(htmlBrand).toContain("Mint Action");

    const htmlLoading = renderToStaticMarkup(createElement(Button, { loading: true }, "Submitting"));
    expect(htmlLoading).toContain("aria-busy=\"true\"");
    expect(htmlLoading).toContain("Submitting");
    expect(htmlLoading).toContain("animate-spin");
  });

  it("StatusBadge renders semantic tone and optional indicator dot", () => {
    const htmlSuccess = renderToStaticMarkup(createElement(StatusBadge, { tone: "success", label: "Completed", withDot: true }));
    expect(htmlSuccess).toContain("Completed");
    expect(htmlSuccess).toContain("rounded-full");

    const htmlDestructive = renderToStaticMarkup(createElement(StatusBadge, { tone: "destructive", label: "Cancelled", withDot: false }));
    expect(htmlDestructive).toContain("Cancelled");
    expect(htmlDestructive).not.toContain("rounded-full");
  });

  it("Money formats Indian Rupee amounts in paise accurately with tabular nums", () => {
    const html = renderToStaticMarkup(createElement(Money, { paise: 149950 }));
    expect(html).toContain("₹1,499.5");
    expect(html).toContain("tabular-nums");
  });

  it("Spinner renders sm, md, lg sizes with appropriate SVG attributes", () => {
    const sm = renderToStaticMarkup(createElement(Spinner, { size: "sm" }));
    expect(sm).toContain("animate-spin");
    expect(sm).toContain("h-3.5 w-3.5");

    const lg = renderToStaticMarkup(createElement(Spinner, { size: "lg" }));
    expect(lg).toContain("h-7 w-7");
  });

  it("Empty state renders title, description, and action slot", () => {
    const actionBtn = createElement(Button, { size: "sm" }, "Add Item");
    const html = renderToStaticMarkup(
      createElement(Empty, {
        title: "No tenants registered",
        description: "Create a tenant to begin onboarding.",
        action: actionBtn,
      })
    );
    expect(html).toContain("No tenants registered");
    expect(html).toContain("Create a tenant to begin onboarding.");
    expect(html).toContain("Add Item");
  });

  it("Composed Skeletons render with ARIA hidden attributes and proper structural elements", () => {
    const header = renderToStaticMarkup(createElement(PageHeaderSkeleton));
    expect(header).toContain("aria-hidden=\"true\"");

    const metrics = renderToStaticMarkup(createElement(MetricCardsSkeleton, { count: 3 }));
    expect(metrics).toContain("aria-hidden=\"true\"");

    const table = renderToStaticMarkup(createElement(DataTableSkeleton, { rows: 3, columns: 3 }));
    expect(table).toContain("aria-hidden=\"true\"");

    const form = renderToStaticMarkup(createElement(FormSectionSkeleton, { fields: 2 }));
    expect(form).toContain("aria-hidden=\"true\"");

    const detail = renderToStaticMarkup(createElement(DetailPageSkeleton));
    expect(detail).toContain("aria-hidden=\"true\"");

    const auth = renderToStaticMarkup(createElement(AuthCardSkeleton));
    expect(auth).toContain("aria-hidden=\"true\"");

    const account = renderToStaticMarkup(createElement(AccountPageSkeleton));
    expect(account).toContain("aria-hidden=\"true\"");
  });

  it("SharedDataTable renders data rows, column headers, and empty fallback", () => {
    type TestRow = { id: string; name: string };
    const rows: TestRow[] = [{ id: "1", name: "Row One" }, { id: "2", name: "Row Two" }];
    const columns = [
      { id: "name", header: "Name", cell: (r: TestRow) => r.name },
    ];

    const filled = renderToStaticMarkup(
      createElement<SharedDataTableProps<TestRow>>(SharedDataTable, {
        rows,
        columns,
        getRowId: (r: TestRow) => r.id,
        empty: createElement("div", null, "Empty rows"),
      })
    );
    expect(filled).toContain("Row One");
    expect(filled).toContain("Row Two");

    const empty = renderToStaticMarkup(
      createElement<SharedDataTableProps<TestRow>>(SharedDataTable, {
        rows: [],
        columns,
        getRowId: (r: TestRow) => r.id,
        empty: createElement("div", null, "Empty rows"),
      })
    );
    expect(empty).toContain("Empty rows");
  });

  it("Pagination renders page numbers and total range formatted for en-IN", () => {
    const html = renderToStaticMarkup(
      createElement(Pagination, {
        page: 2,
        pageSize: 25,
        total: 100,
        onPageChange: () => {},
        onPageSizeChange: () => {},
      })
    );
    expect(html).toContain("26–50");
    expect(html).toContain("of 100");
  });
});
