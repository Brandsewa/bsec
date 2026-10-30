import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Edit2, Search, Trash2, Upload } from "lucide-react";
import { Badge, Button, Field, FormSkeleton, InfoTip, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@bs/ui";
import { formatMoney, toMajorUnits, toMinorUnits } from "@bs/contracts/money";
import type { MarketDetail } from "@bs/contracts";
import { client, orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

export function MarketPricingTab({
  market,
  baseCurrency,
  onUpdated,
}: {
  market: MarketDetail;
  baseCurrency: string;
  onUpdated: () => void;
}) {
  const isCrossCurrency = market.currency !== baseCurrency;
  const [fxRate, setFxRate] = useState<string>(market.fxRate !== null ? String(market.fxRate) : "");
  const [adjustPercent, setAdjustPercent] = useState<string>(String(market.priceAdjustBps / 100));
  const [isSavingRate, setIsSavingRate] = useState(false);

  // Variant Prices table state
  const [search, setSearch] = useState("");
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [inlinePrice, setInlinePrice] = useState<string>("");
  const [inlineCompareAt, setInlineCompareAt] = useState<string>("");
  const [isSavingPrice, setIsSavingPrice] = useState(false);

  const pricesQuery = useQuery(
    orpc.admin.markets.listPrices.queryOptions({
      input: {
        id: market.id,
        search: search.trim() ? search.trim() : undefined,
        limit: 100,
      },
    }),
  );

  async function handleSaveRate(e: React.FormEvent) {
    e.preventDefault();
    if (isCrossCurrency && (!fxRate || Number(fxRate) <= 0)) {
      toast.error("Please enter a valid exchange rate above 0");
      return;
    }

    setIsSavingRate(true);
    try {
      const bps = Math.round(Number(adjustPercent || "0") * 100);
      await client.admin.markets.update({
        id: market.id,
        fxRate: isCrossCurrency ? Number(fxRate) : undefined,
        priceAdjustBps: bps,
      });

      toast.success("Pricing rules updated");
      void pricesQuery.refetch();
      onUpdated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSavingRate(false);
    }
  }

  async function handleSaveFixedPrice(variantId: string) {
    setIsSavingPrice(true);
    try {
      const minorPrice = inlinePrice ? toMinorUnits(Number(inlinePrice), market.currency) : null;
      const minorCompareAt = inlineCompareAt ? toMinorUnits(Number(inlineCompareAt), market.currency) : null;

      await client.admin.markets.setFixedPrices({
        id: market.id,
        items: [
          {
            variantId,
            price: minorPrice,
            compareAtPrice: minorCompareAt,
          },
        ],
      });

      toast.success("Fixed price saved");
      setEditingVariantId(null);
      void pricesQuery.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSavingPrice(false);
    }
  }

  async function handleClearFixedPrice(variantId: string) {
    try {
      await client.admin.markets.setFixedPrices({
        id: market.id,
        items: [{ variantId, price: null }],
      });
      toast.success("Price override cleared; reverted to derived calculation");
      void pricesQuery.refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  function handleExportCsv() {
    const rows = pricesQuery.data?.rows ?? [];
    if (rows.length === 0) {
      toast.error("No prices to export");
      return;
    }

    const headers = ["Variant ID", "Product Title", "Variant Title", "SKU", "Base Price", "Market Price", "Compare At Price", "Source"];
    const csvLines = [headers.join(",")];

    for (const r of rows) {
      const marketPriceFormatted = r.marketPrice != null ? toMajorUnits(r.marketPrice, market.currency) : "";
      const compareAtFormatted = r.marketCompareAtPrice != null ? toMajorUnits(r.marketCompareAtPrice, market.currency) : "";
      const basePriceFormatted = toMajorUnits(r.basePrice, baseCurrency);

      const line = [
        `"${r.variantId}"`,
        `"${r.productTitle.replace(/"/g, '""')}"`,
        `"${r.variantTitle.replace(/"/g, '""')}"`,
        `"${r.sku.replace(/"/g, '""')}"`,
        `"${basePriceFormatted}"`,
        `"${marketPriceFormatted}"`,
        `"${compareAtFormatted}"`,
        `"${r.source}"`,
      ];
      csvLines.push(line.join(","));
    }

    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `market-prices-${market.handle}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  }

  function handleImportCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) {
          toast.error("CSV file is empty or missing headers");
          return;
        }

        const items: { variantId: string; price: number | null; compareAtPrice?: number | null }[] = [];
        // Header line: Variant ID, Product Title, Variant Title, SKU, Base Price, Market Price, Compare At Price, Source
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          const parts = line.split(",").map((p) => p.replace(/^"|"$/g, "").trim());
          const variantId = parts[0];
          const priceStr = parts[5];
          const compareAtStr = parts[6];

          if (variantId) {
            const parsedPrice = priceStr && priceStr !== "" ? toMinorUnits(Number(priceStr), market.currency) : null;
            const parsedCompare = compareAtStr && compareAtStr !== "" ? toMinorUnits(Number(compareAtStr), market.currency) : null;
            items.push({
              variantId,
              price: parsedPrice,
              compareAtPrice: parsedCompare,
            });
          }
        }

        if (items.length === 0) {
          toast.error("No valid variant price rows found in CSV");
          return;
        }

        const res = await client.admin.markets.setFixedPrices({
          id: market.id,
          items: items.slice(0, 500),
        });

        toast.success(`Updated ${res.updated} variant prices`);
        void pricesQuery.refetch();
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="space-y-6 text-xs">
      {/* Rate & Adjustment Form */}
      <form onSubmit={handleSaveRate} className="rounded-lg border border-border p-4 bg-muted/10 space-y-4">
        <div>
          <h3 className="font-medium text-foreground text-sm">Exchange Rate & Price Adjustment</h3>
          <p className="text-muted-foreground mt-0.5">
            Prices for this market are derived from each product variant&apos;s base price using the exchange rate and adjustment markup.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {isCrossCurrency ? (
            <Field
              id="market-fx"
              label={`Exchange Rate (1 ${baseCurrency} = ? ${market.currency})`}
              hint="You own the exchange rate. Brand Sewa does not alter your rate automatically."
            >
              <Input
                id="market-fx"
                type="number"
                step="0.0001"
                min="0.0001"
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
                placeholder="e.g. 0.012"
                required
              />
            </Field>
          ) : (
            <div className="flex items-center text-muted-foreground pt-5">
              This market uses the store currency ({baseCurrency}). Base FX rate is 1.0.
            </div>
          )}

          <Field
            id="market-adjust-bps"
            label="Price Adjustment (%)"
            hint="Markup or markdown applied after exchange conversion (+10 for +10%, -5 for -5%)."
          >
            <Input
              id="market-adjust-bps"
              type="number"
              step="0.1"
              min="-90"
              max="1000"
              value={adjustPercent}
              onChange={(e) => setAdjustPercent(e.target.value)}
              placeholder="0"
            />
          </Field>
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <InfoTip>Rates should be reviewed periodically. Keep rates updated to avoid unintended currency loss.</InfoTip>
            Rates are managed manually.
          </p>
          <Button type="submit" size="sm" disabled={isSavingRate}>
            {isSavingRate ? "Updating…" : "Update rules"}
          </Button>
        </div>
      </form>

      {/* Variant Prices Table */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-medium text-foreground text-sm">Variant Pricing</h3>
            <p className="text-muted-foreground mt-0.5">
              Set fixed price overrides per variant or let prices calculate from the base price.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleExportCsv}>
              <Download className="mr-1.5 size-3.5" /> Export CSV
            </Button>
            <label className="cursor-pointer">
              <input type="file" accept=".csv" className="hidden" onChange={handleImportCsv} />
              <Button size="sm" variant="outline" asChild>
                <span>
                  <Upload className="mr-1.5 size-3.5" /> Import CSV
                </span>
              </Button>
            </label>
          </div>
        </div>

        <div className="flex items-center gap-2 max-w-sm">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product or SKU..."
              className="pl-8 h-8"
            />
          </div>
        </div>

        {pricesQuery.isLoading ? (
          <FormSkeleton fields={5} />
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product / Variant</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Base ({baseCurrency})</TableHead>
                  <TableHead>Market Price ({market.currency})</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pricesQuery.data?.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                      No variants found.
                    </TableCell>
                  </TableRow>
                ) : (
                  pricesQuery.data?.rows.map((row) => {
                    const isEditing = editingVariantId === row.variantId;

                    return (
                      <TableRow key={row.variantId}>
                        <TableCell>
                          <div className="font-medium text-foreground">{row.productTitle}</div>
                          {row.variantTitle ? (
                            <div className="text-[11px] text-muted-foreground">{row.variantTitle}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">{row.sku || "—"}</TableCell>
                        <TableCell>{formatMoney(row.basePrice, baseCurrency)}</TableCell>
                        <TableCell>
                          {isEditing ? (
                            <div className="flex items-center gap-1.5 max-w-[140px]">
                              <Input
                                value={inlinePrice}
                                onChange={(e) => setInlinePrice(e.target.value)}
                                placeholder="Price"
                                className="h-7 text-xs"
                              />
                            </div>
                          ) : row.marketPrice != null ? (
                            <span className="font-medium text-foreground">
                              {formatMoney(row.marketPrice, market.currency)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Not set</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.source === "fixed" ? (
                            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px]">
                              Fixed Override
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">
                              Derived
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => setEditingVariantId(null)}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={isSavingPrice}
                                onClick={() => handleSaveFixedPrice(row.variantId)}
                              >
                                Save
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => {
                                  setEditingVariantId(row.variantId);
                                  setInlinePrice(
                                    row.marketPrice != null ? String(toMajorUnits(row.marketPrice, market.currency)) : "",
                                  );
                                  setInlineCompareAt(
                                    row.marketCompareAtPrice != null
                                      ? String(toMajorUnits(row.marketCompareAtPrice, market.currency))
                                      : "",
                                  );
                                }}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              {row.source === "fixed" ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                  onClick={() => handleClearFixedPrice(row.variantId)}
                                  title="Clear fixed price"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          )}
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
