import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Button, Input, Field, SimpleSelect, toast } from "@bs/ui";
import { CountryPicker, useTakenCountries } from "./country-picker.tsx";
import { client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { suggestCurrencyForCountries } from "@bs/contracts/countries";
import {
  MARKET_CURRENCY_OPTIONS,
  IMPERIAL_COUNTRIES,
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
  const takenCountries = useTakenCountries();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState(baseCurrency);
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [countries, setCountries] = useState<string[]>([]);
  const [pathPrefix, setPathPrefix] = useState("");
  const [fxRate, setFxRate] = useState<string>("");
  const [unitSystem, setUnitSystem] = useState<"metric" | "imperial">("metric");
  const [taxDisplay, setTaxDisplay] = useState<"inclusive" | "exclusive">("exclusive");
  const [rounding, setRounding] = useState<"none" | "nearest_whole" | "charm_99" | "charm_95">("none");
  const [priceAdjustPercent, setPriceAdjustPercent] = useState<string>("0");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Picking countries suggests their currency and units, until the merchant chooses a currency themselves.
  function changeCountries(next: string[]) {
    setCountries(next);
    if (!currencyTouched) {
      const suggested = suggestCurrencyForCountries(next);
      if (suggested) setCurrency(suggested);
    }
    setUnitSystem(next.length > 0 && next.every((c) => IMPERIAL_COUNTRIES.has(c)) ? "imperial" : "metric");
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
            Name the market, choose the countries it covers and the currency it sells in.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="market-name" label="Market name">
              <Input
                id="market-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Europe, Gulf, Rest of world"
                required
              />
            </Field>

            <Field id="market-currency" label="Currency">
              <SimpleSelect
                value={currency}
                onChange={(val) => {
                  setCurrency(val);
                  setCurrencyTouched(true);
                }}
                options={MARKET_CURRENCY_OPTIONS}
              />
            </Field>
          </div>

          <Field id="market-countries" label="Target Countries" hint="Countries in this market. A country can be in only one market.">
            <CountryPicker value={countries} onChange={changeCountries} taken={takenCountries} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="market-prefix" label="URL Path Prefix" hint="e.g. /us or /global. Clashes with store routes are blocked.">
              <Input
                id="market-prefix"
                value={pathPrefix}
                onChange={(e) => setPathPrefix(e.target.value)}
                placeholder="Leave blank to generate one"
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
