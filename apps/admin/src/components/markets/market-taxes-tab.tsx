import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, SimpleSelect, Switch, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from "@bs/ui";
import type { MarketDetail } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";

interface TaxRow {
  id?: string;
  country: string;
  region: string;
  taxName: string;
  ratePercent: string;
}

export function MarketTaxesTab({
  market,
  onUpdated,
}: {
  market: MarketDetail;
  onUpdated: () => void;
}) {
  const [taxCollect, setTaxCollect] = useState(market.taxCollect);
  const [taxShippingToo, setTaxShippingToo] = useState(market.taxShippingToo);
  const [taxRules, setTaxRules] = useState<TaxRow[]>(
    market.taxRules.map((r) => ({
      id: r.id,
      country: r.country,
      region: r.region,
      taxName: r.taxName,
      ratePercent: String(r.rateBps / 100),
    })),
  );
  const [isSaving, setIsSaving] = useState(false);

  // Available countries for rules must be within market.countries
  const countryOptions = market.countries.map((c) => ({
    value: c,
    label: c,
  }));

  function handleAddRow() {
    const firstCountry = market.countries[0];
    if (!firstCountry) {
      toast.error("This market has no assigned countries");
      return;
    }
    setTaxRules((prev) => [
      ...prev,
      {
        country: firstCountry,
        region: "*",
        taxName: "Sales Tax",
        ratePercent: "0",
      },
    ]);
  }

  function handleRemoveRow(index: number) {
    setTaxRules((prev) => prev.filter((_, i) => i !== index));
  }

  function handleUpdateRow(index: number, patch: Partial<TaxRow>) {
    setTaxRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      // 1. Update collection switches
      await client.admin.markets.update({
        id: market.id,
        taxCollect,
        taxShippingToo,
      });

      // 2. Update tax rules
      const formattedRules = taxRules.map((r) => ({
        country: r.country.toUpperCase(),
        region: r.region.trim(),
        taxName: r.taxName.trim(),
        rateBps: Math.round(Number(r.ratePercent || "0") * 100),
      }));

      await client.admin.markets.setTaxRules({
        id: market.id,
        rules: formattedRules,
      });

      toast.success("Tax rules saved");
      onUpdated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 text-xs">
      <div>
        <h3 className="font-medium text-foreground text-sm">Tax Collection & Regional Rules</h3>
        <p className="text-muted-foreground mt-0.5">
          Configure whether taxes are collected at checkout for this market. You are responsible for configuring accurate statutory tax rates.
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 bg-muted/10 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-foreground">Collect taxes in this market</div>
            <div className="text-muted-foreground text-[11px]">Calculate and collect regional sales tax, GST, or VAT at checkout.</div>
          </div>
          <Switch checked={taxCollect} onCheckedChange={setTaxCollect} />
        </div>

        <div className="flex items-center justify-between border-t border-border/60 pt-3">
          <div>
            <div className="font-medium text-foreground">Charge tax on shipping rates</div>
            <div className="text-muted-foreground text-[11px]">Apply the market tax rate to shipping fees in addition to items.</div>
          </div>
          <Switch checked={taxShippingToo} onCheckedChange={setTaxShippingToo} disabled={!taxCollect} />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-foreground text-sm">Tax Rates Table</h4>
            <p className="text-muted-foreground mt-0.5">Define rates by country and region (use &apos;*&apos; for nationwide rate).</p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={handleAddRow} disabled={!taxCollect}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add tax rate
          </Button>
        </div>

        {taxRules.length === 0 ? (
          <div className="rounded-md border border-border p-6 text-center text-muted-foreground">
            No tax rates configured for this market.
          </div>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Country</TableHead>
                  <TableHead className="w-28">Region</TableHead>
                  <TableHead>Tax Name</TableHead>
                  <TableHead className="w-28">Rate (%)</TableHead>
                  <TableHead className="w-16 text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taxRules.map((rule, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <SimpleSelect
                        value={rule.country}
                        onChange={(val: string) => handleUpdateRow(idx, { country: val })}
                        options={countryOptions}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={rule.region}
                        onChange={(e) => handleUpdateRow(idx, { region: e.target.value })}
                        placeholder="*"
                        className="h-8 text-xs font-mono"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={rule.taxName}
                        onChange={(e) => handleUpdateRow(idx, { taxName: e.target.value })}
                        placeholder="e.g. Sales Tax, GST"
                        className="h-8 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={rule.ratePercent}
                        onChange={(e) => handleUpdateRow(idx, { ratePercent: e.target.value })}
                        className="h-8 text-xs font-mono"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveRow(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save tax settings"}
        </Button>
      </div>
    </form>
  );
}
