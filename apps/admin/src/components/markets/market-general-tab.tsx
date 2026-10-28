import { useState } from "react";
import { Button, Field, Input, MultiSelect, SimpleSelect, toast } from "@bs/ui";
import { client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { MarketDetail } from "@bs/contracts";
import {
  AVAILABLE_CURRENCIES,
  PLATFORM_SUPPORTED_COUNTRIES,
  ROUNDING_OPTIONS,
  UNIT_SYSTEM_OPTIONS,
  TAX_DISPLAY_OPTIONS,
} from "./types.ts";

export function MarketGeneralTab({
  market,
  onUpdated,
}: {
  market: MarketDetail;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(market.name);
  const [currency, setCurrency] = useState(market.currency);
  const [countries, setCountries] = useState<string[]>(market.countries);
  const [pathPrefix, setPathPrefix] = useState(market.pathPrefix ?? "");
  const [unitSystem, setUnitSystem] = useState<"metric" | "imperial">(market.unitSystem ?? "metric");
  const [taxDisplay, setTaxDisplay] = useState<"inclusive" | "exclusive">(market.taxDisplay);
  const [rounding, setRounding] = useState<"none" | "nearest_whole" | "charm_99" | "charm_95">(market.rounding);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Market name is required");
      return;
    }
    if (countries.length === 0) {
      toast.error("At least one country is required");
      return;
    }

    setIsSaving(true);
    try {
      // 1. Update countries if changed
      const countriesChanged =
        countries.length !== market.countries.length ||
        countries.some((c) => !market.countries.includes(c));

      if (countriesChanged) {
        await client.admin.markets.setCountries({
          id: market.id,
          countries,
        });
      }

      // 2. Update general details
      await client.admin.markets.update({
        id: market.id,
        name: name.trim(),
        currency: market.isBase ? undefined : currency,
        pathPrefix: pathPrefix.trim() ? pathPrefix.trim() : null,
        unitSystem,
        taxDisplay,
        rounding,
      });

      toast.success("Market general settings saved");
      onUpdated();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4 text-xs">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="edit-market-name" label="Market name">
          <Input
            id="edit-market-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. United States"
            required
          />
        </Field>

        <Field id="edit-market-currency" label="Currency" hint={market.isBase ? "Base market currency cannot be changed" : undefined}>
          {market.isBase ? (
            <Input id="edit-market-currency" value={currency} disabled className="bg-muted text-muted-foreground font-mono" />
          ) : (
            <SimpleSelect
              value={currency}
              onChange={setCurrency}
              options={AVAILABLE_CURRENCIES}
            />
          )}
        </Field>
      </div>

      <Field
        id="edit-market-countries"
        label="Target Countries"
        hint="Countries assigned to this market. A country cannot belong to multiple markets."
      >
        <MultiSelect
          options={PLATFORM_SUPPORTED_COUNTRIES}
          value={countries}
          onChange={setCountries}
          placeholder="Select countries..."
          searchPlaceholder="Search country..."
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="edit-market-prefix"
          label="URL Path Prefix"
          hint="Subdirectory used for this market on the storefront (e.g. /us). Leave blank for default."
        >
          <Input
            id="edit-market-prefix"
            value={pathPrefix}
            onChange={(e) => setPathPrefix(e.target.value)}
            placeholder="/us"
          />
        </Field>

        <Field id="edit-market-rounding" label="Price Rounding Rule">
          <SimpleSelect
            value={rounding}
            onChange={(val) => setRounding(val as "none" | "nearest_whole" | "charm_99" | "charm_95")}
            options={ROUNDING_OPTIONS}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="edit-market-tax-display" label="Tax Display">
          <SimpleSelect
            value={taxDisplay}
            onChange={(val) => setTaxDisplay(val as "inclusive" | "exclusive")}
            options={TAX_DISPLAY_OPTIONS}
          />
        </Field>

        <Field id="edit-market-unit-system" label="Measurement System">
          <SimpleSelect
            value={unitSystem}
            onChange={(val) => setUnitSystem(val as "metric" | "imperial")}
            options={UNIT_SYSTEM_OPTIONS}
          />
        </Field>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
