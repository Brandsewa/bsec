import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, Search } from "lucide-react";
import { Button, FormSkeleton, Input, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@bs/ui";
import type { MarketDetail } from "@bs/contracts";
import { client, orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

export function MarketCatalogTab({
  market,
  onUpdated,
}: {
  market: MarketDetail;
  onUpdated: () => void;
}) {
  const [catalogMode, setCatalogMode] = useState<"all" | "selected">(market.catalogMode);
  const [search, setSearch] = useState("");
  const [isUpdatingMode, setIsUpdatingMode] = useState(false);
  const [togglingProductId, setTogglingProductId] = useState<string | null>(null);

  // We query products from admin.products.list
  const productsQuery = useQuery(
    orpc.admin.products.list.queryOptions({
      input: {
        search: search.trim() ? search.trim() : undefined,
        limit: 50,
      },
    }),
  );

  async function handleToggleMode(newMode: "all" | "selected") {
    setIsUpdatingMode(true);
    try {
      await client.admin.markets.update({
        id: market.id,
        catalogMode: newMode,
      });
      setCatalogMode(newMode);
      toast.success(`Catalog mode set to: ${newMode === "all" ? "All products" : "Selected products only"}`);
      onUpdated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsUpdatingMode(false);
    }
  }

  async function handleToggleProductPublish(productId: string, currentPublished: boolean) {
    setTogglingProductId(productId);
    try {
      await client.admin.markets.setProductVisibility({
        id: market.id,
        items: [{ productId, published: !currentPublished }],
      });
      toast.success(`Product visibility updated`);
      void productsQuery.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTogglingProductId(null);
    }
  }

  return (
    <div className="space-y-6 text-xs">
      {/* Mode selection */}
      <div className="rounded-lg border border-border p-4 bg-muted/10 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-medium text-foreground text-sm">Catalog Inclusion</h3>
            <p className="text-muted-foreground mt-0.5">
              Choose whether shoppers in this market see all products in your store, or only specifically selected products.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className={catalogMode === "all" ? "font-medium text-foreground" : "text-muted-foreground"}>
              All products
            </span>
            <Switch
              checked={catalogMode === "selected"}
              onCheckedChange={(checked) => handleToggleMode(checked ? "selected" : "all")}
              disabled={isUpdatingMode}
            />
            <span className={catalogMode === "selected" ? "font-medium text-foreground" : "text-muted-foreground"}>
              Selected only
            </span>
          </div>
        </div>
      </div>

      {/* Product list */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-medium text-foreground text-sm">
              {catalogMode === "all" ? "Product Exclusions" : "Published Products"}
            </h3>
            <p className="text-muted-foreground mt-0.5">
              {catalogMode === "all"
                ? "All products are visible by default. You can unpublish specific products from this market."
                : "Only products toggled as active are visible to customers in this market."}
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..."
              className="pl-8 h-8"
            />
          </div>
        </div>

        {productsQuery.isLoading ? (
          <FormSkeleton fields={4} />
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Visible in Market</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productsQuery.data?.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
                      No products found.
                    </TableCell>
                  </TableRow>
                ) : (
                  productsQuery.data?.items.map((p) => {
                    const isToggling = togglingProductId === p.id;

                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium text-foreground">{p.title}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">{p.slug}</div>
                        </TableCell>
                        <TableCell className="capitalize text-muted-foreground">{p.status}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={isToggling}
                            onClick={() => handleToggleProductPublish(p.id, true)}
                          >
                            <Eye className="mr-1.5 h-3 w-3" /> Toggle Visibility
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
