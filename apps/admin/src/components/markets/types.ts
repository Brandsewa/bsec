export interface MarketPreset {
  id: "usa" | "canada" | "india" | "international" | "custom";
  title: string;
  description: string;
  currency: string;
  countries: string[];
  name: string;
  pathPrefix: string;
  unitSystem: "metric" | "imperial";
  taxDisplay: "inclusive" | "exclusive";
  defaultFxRate?: number;
}

export const MARKET_PRESETS: MarketPreset[] = [
  {
    id: "usa",
    title: "United States (USD)",
    description: "Sell in US Dollars with imperial units and exclusive tax.",
    currency: "USD",
    countries: ["US"],
    name: "United States",
    pathPrefix: "/us",
    unitSystem: "imperial",
    taxDisplay: "exclusive",
  },
  {
    id: "canada",
    title: "Canada (CAD)",
    description: "Sell in Canadian Dollars with metric units and exclusive tax.",
    currency: "CAD",
    countries: ["CA"],
    name: "Canada",
    pathPrefix: "/ca",
    unitSystem: "metric",
    taxDisplay: "exclusive",
  },
  {
    id: "india",
    title: "India (INR)",
    description: "Sell in Indian Rupees with metric units and tax-inclusive pricing.",
    currency: "INR",
    countries: ["IN"],
    name: "India",
    pathPrefix: "/in",
    unitSystem: "metric",
    taxDisplay: "inclusive",
  },
  {
    id: "international",
    title: "International (USD)",
    description: "Global market priced in USD covering US and Canada.",
    currency: "USD",
    countries: ["US", "CA"],
    name: "International",
    pathPrefix: "/global",
    unitSystem: "metric",
    taxDisplay: "exclusive",
  },
];

export const AVAILABLE_CURRENCIES = [
  { value: "INR", label: "INR - Indian Rupee (₹)" },
  { value: "USD", label: "USD - US Dollar ($)" },
  { value: "CAD", label: "CAD - Canadian Dollar ($)" },
];

export const PLATFORM_SUPPORTED_COUNTRIES = [
  { value: "IN", label: "India (IN)" },
  { value: "US", label: "United States (US)" },
  { value: "CA", label: "Canada (CA)" },
];

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
