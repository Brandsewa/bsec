import { COUNTRY_CURRENCIES, listCountries } from "@bs/contracts/countries";
import { currencyLabel } from "@bs/contracts/money";

/** Every country a market can cover, by name. */
export const MARKET_COUNTRY_OPTIONS = listCountries().map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }));

/** Every currency in use by at least one country, as "USD - US Dollar ($)". */
export const MARKET_CURRENCY_OPTIONS = [...COUNTRY_CURRENCIES]
  .map((code) => ({ value: code, label: currencyLabel(code) }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** Countries that use imperial units day to day. */
export const IMPERIAL_COUNTRIES: ReadonlySet<string> = new Set(["US", "LR", "MM"]);

export const ROUNDING_OPTIONS = [
  { value: "none", label: "No rounding (exact calculated price)" },
  { value: "nearest_whole", label: "Nearest whole unit (.00)" },
  { value: "charm_99", label: "Charm ending in .99" },
  { value: "charm_95", label: "Charm ending in .95" },
];

export const UNIT_SYSTEM_OPTIONS = [
  { value: "metric", label: "Metric (kg, g, cm, m)" },
  { value: "imperial", label: "Imperial (lb, oz, in, ft)" },
];

export const TAX_DISPLAY_OPTIONS = [
  { value: "exclusive", label: "Tax exclusive (added at checkout)" },
  { value: "inclusive", label: "Tax inclusive (included in displayed price)" },
];
