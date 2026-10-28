import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Button, Input, Field, MultiSelect, SimpleSelect, toast } from "@bs/ui";
import { client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import {
  MARKET_PRESETS,
  AVAILABLE_CURRENCIES,
  PLATFORM_SUPPORTED_COUNTRIES,
  ROUNDING_OPTIONS,
  UNIT_SYSTEM_OPTIONS,
  TAX_DISPLAY_OPTIONS,
} from "./types.ts";

export function AddMarketDialog({
  open,
  onOpenChange,
  baseCurrency,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseCurrency: string;
  onCreated: (createdId: string) => void;
}) {
  const [selectedPreset, setSelectedPreset] = useState<string>("usa");
  const [name, setName] = useState("United States");
  const [currency, setCurrency] = useState("USD");
  const [countries, setCountries] = useState<string[]>(["US"]);
  const [pathPrefix, setPathPrefix] = useState("/us");
  const [fxRate, setFxRate] = useState<string>("0.012");
  const [unitSystem, setUnitSystem] = useState<"metric" | "imperial">("imperial");
  const [taxDisplay, setTaxDisplay] = useState<"inclusive" | "exclusive">("exclusive");
  const [rounding, setRounding] = useState<"none" | "nearest_whole" | "charm_99" | "charm_95">("none");
  const [priceAdjustPercent, setPriceAdjustPercent] = useState<string>("0");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function applyPreset(presetId: string) {
    setSelectedPreset(presetId);
    const p = MARKET_PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    setName(p.name);
    setCurrency(p.currency);
    setCountries(p.countries);
    setPathPrefix(p.pathPrefix);
    setUnitSystem(p.unitSystem);
    setTaxDisplay(p.taxDisplay);
    if (p.currency === baseCurrency) {
      setFxRate("");
    } else if (p.currency === "USD") {
      setFxRate("0.012");
    } else if (p.currency === "CAD") {
      setFxRate("0.016");
    }
  }

  const isCrossCurrency = currency !== baseCurrency;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Please enter a market name");
      return;
    }
    if (countries.length === 0) {
      toast.error("Please select at least one country");
      return;
    }
    if (isCrossCurrency && (!fxRate || Number(fxRate) <= 0)) {
      toast.error("Please enter a valid exchange rate above 0");
      return;
    }

    setIsSubmitting(true);
    try {
      const parsedFx = isCrossCurrency ? Number(fxRate) : undefined;
      const bps = Math.round(Number(priceAdjustPercent || "0") * 100);

      const created = await client.admin.markets.create({
        name: name.trim(),
        currency: currency.toUpperCase(),
        countries,
        pathPrefix: pathPrefix.trim() ? pathPrefix.trim() : undefined,
        fxRate: parsedFx,
        priceAdjustBps: bps,
        rounding,
        taxDisplay,
        unitSystem,
      });

      toast.success(`Market "${created.name}" created`);
      onOpenChange(false);
      onCreated(created.id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a new market</DialogTitle>
          <DialogDescription>
            Choose a quick preset or customize regional currency, pricing rules, and URL prefix.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="font-medium text-foreground block mb-2">Preset</label>
            <div className="grid grid-cols-2 gap-2">
              {MARKET_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`p-2.5 rounded-lg border text-left transition-colors ${
                    selectedPreset === p.id
                      ? "border-primary bg-primary/5 text-foreground font-medium"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  <div className="font-medium text-foreground">{p.title}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{p.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="market-name" label="Market name">
              <Input
                id="market-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSelectedPreset("custom");
                }}
                placeholder="e.g. United States"
                required
              />
            </Field>

            <Field id="market-currency" label="Currency">
              <SimpleSelect
                value={currency}
                onChange={(val) => {
                  setCurrency(val);
                  setSelectedPreset("custom");
                }}
                options={AVAILABLE_CURRENCIES}
              />
            </Field>
          </div>

          <Field id="market-countries" label="Target Countries" hint="Countries in this market. A country can be in only one market.">
            <MultiSelect
              options={PLATFORM_SUPPORTED_COUNTRIES}
              value={countries}
              onChange={(next) => {
                setCountries(next);
                setSelectedPreset("custom");
              }}
              placeholder="Select countries..."
              searchPlaceholder="Search country..."
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="market-prefix" label="URL Path Prefix" hint="e.g. /us or /global. Clashes with store routes are blocked.">
              <Input
                id="market-prefix"
                value={pathPrefix}
                onChange={(e) => {
                  setPathPrefix(e.target.value);
                  setSelectedPreset("custom");
                }}
                placeholder="/us"
              />
            </Field>

            {isCrossCurrency ? (
              <Field
                id="market-fx-rate"
                label={`Exchange Rate (1 ${baseCurrency} = ? ${currency})`}
                hint="Manual FX rate used to derive variant prices."
              >
                <Input
                  id="market-fx-rate"
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
              <div className="flex items-center text-muted-foreground text-[11px] pt-6">
                Same as store currency ({baseCurrency}). FX rate is 1.0.
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="market-rounding" label="Price Rounding">
              <SimpleSelect
                value={rounding}
                onChange={(val) => setRounding(val as "none" | "nearest_whole" | "charm_99" | "charm_95")}
                options={ROUNDING_OPTIONS}
              />
            </Field>

            <Field id="market-adjust" label="Price adjustment (%)" hint="E.g. +10 for +10% markup, -5 for 5% discount">
              <Input
                id="market-adjust"
                type="number"
                step="0.1"
                min="-90"
                max="1000"
                value={priceAdjustPercent}
                onChange={(e) => setPriceAdjustPercent(e.target.value)}
                placeholder="0"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="market-tax-display" label="Tax display">
              <SimpleSelect
                value={taxDisplay}
                onChange={(val) => setTaxDisplay(val as "inclusive" | "exclusive")}
                options={TAX_DISPLAY_OPTIONS}
              />
            </Field>

            <Field id="market-unit-system" label="Measurement units">
              <SimpleSelect
                value={unitSystem}
                onChange={(val) => setUnitSystem(val as "metric" | "imperial")}
                options={UNIT_SYSTEM_OPTIONS}
              />
            </Field>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create market"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
