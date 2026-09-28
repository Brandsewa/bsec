import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { cn } from "../src/lib/cn.ts";
import { TableSkeleton } from "../src/components/skeleton.tsx";
import { PageBreadcrumbs } from "../src/layout/page.tsx";

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
});
