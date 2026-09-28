import { describe, expect, it } from "vitest";

describe("Admin Catalog & Inventory Routes", () => {
  it("exports valid Route definition with pendingComponent for products index", async () => {
    const mod = await import("../src/routes/_store/products/index.tsx");
    expect(mod.Route).toBeDefined();
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });

  it("exports valid Route definition with pendingComponent for products new", async () => {
    const mod = await import("../src/routes/_store/products/new.tsx");
    expect(mod.Route).toBeDefined();
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });

  it("exports valid Route definition with pendingComponent for products detail ($id)", async () => {
    const mod = await import("../src/routes/_store/products/$id.tsx");
    expect(mod.Route).toBeDefined();
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });

  it("exports valid Route definition with pendingComponent for inventory index", async () => {
    const mod = await import("../src/routes/_store/inventory/index.tsx");
    expect(mod.Route).toBeDefined();
    expect(mod.Route.options.pendingComponent).toBeDefined();
    expect(mod.Route.options.component).toBeDefined();
  });
});
