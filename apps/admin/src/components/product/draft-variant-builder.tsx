import { Plus, X } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldLabel,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bs/ui";
import { currencySymbol } from "@bs/contracts/money";
import { useStoreCurrency } from "../../lib/use-store-currency.ts";
import { MAX_OPTIONS, MAX_VALUES, MAX_VARIANTS, cleanOptions, optionCombinations, previewGrid, type DraftOption } from "../../lib/variant-grid.ts";
import { ValueChips } from "./variant-builder.tsx";

/** A variant on a product that is not saved yet. `key` identifies its option combination so edits survive option changes. */
export interface DraftVariant {
  key: string;
  title: string;
  optionValues: Record<string, string>;
  sku: string;
  price: string;
  compareAtPrice: string;
}

const DEFAULT_KEY = "__default";

export const defaultDraftVariant = (): DraftVariant => ({ key: DEFAULT_KEY, title: "Default", optionValues: {}, sku: "", price: "", compareAtPrice: "" });

/** Options that are complete enough to produce variants (a name and at least one value). */
export const usableOptions = (options: DraftOption[]): DraftOption[] => cleanOptions(options).filter((o) => o.name && o.values.length > 0);

/** Rebuild the variant rows for these options, keeping what was already typed for combinations that still exist. */
export function regenerateVariants(options: DraftOption[], previous: DraftVariant[]): DraftVariant[] {
  const usable = usableOptions(options);
  if (usable.length === 0) {
    const kept = previous.find((v) => v.key === DEFAULT_KEY) ?? previous[0];
    return [{ ...defaultDraftVariant(), sku: kept?.sku ?? "", price: kept?.price ?? "", compareAtPrice: kept?.compareAtPrice ?? "" }];
  }
  const old = new Map(previous.map((v) => [v.key, v]));
  // The first real combination inherits what was typed on the lone default row.
  const inherit = previous.length === 1 ? previous[0] : undefined;
  return optionCombinations(usable).map((combo, i) => {
    const key = JSON.stringify(combo);
    const kept = old.get(key) ?? (i === 0 ? inherit : undefined);
    return {
      key,
      title: usable.map((o) => combo[o.name]).join(" / "),
      optionValues: combo,
      sku: kept?.sku ?? "",
      price: kept?.price ?? "",
      compareAtPrice: kept?.compareAtPrice ?? "",
    };
  });
}

/**
 * Options and variants for a product that does not exist yet. The variant rows appear as soon as option values are
 * entered, with SKU and price filled in inline; nothing is sent to the server until the product itself is saved.
 */
export function DraftVariantBuilderCard({
  options,
  onOptionsChange,
  variants,
  onVariantsChange,
  priceOnRequest,
  errors,
}: {
  options: DraftOption[];
  onOptionsChange: (next: DraftOption[]) => void;
  variants: DraftVariant[];
  onVariantsChange: (next: DraftVariant[]) => void;
  priceOnRequest: boolean;
  errors: Record<string, string>;
}) {
  const storeCurrency = useStoreCurrency();
  const sym = currencySymbol(storeCurrency);
  const preview = previewGrid(options, []);
  const changeOptions = (next: DraftOption[]) => {
    onOptionsChange(next);
    onVariantsChange(regenerateVariants(next, variants));
  };
  const patchVariant = (key: string, patch: Partial<DraftVariant>) =>
    onVariantsChange(variants.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  const fieldError = (k: string) =>
    errors[k] ? (
      <p role="alert" className="mt-1 text-xs text-destructive">
        {errors[k]}
      </p>
    ) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Variants & Pricing</CardTitle>
        <CardDescription>
          Add options like size or colour to sell this product in different versions. Variants appear below as soon as you add values; set each SKU and price there.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <section className="grid gap-3" aria-label="Options">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Options</h3>
            {options.length < MAX_OPTIONS ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onOptionsChange([...options, { name: "", values: [] }])}>
                <Plus className="mr-1.5 size-3.5" aria-hidden /> Add option
              </Button>
            ) : null}
          </div>

          {options.length > 0 ? (
            <div className="grid gap-3">
              {options.map((opt, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-start">
                  <div className="grid gap-1.5">
                    <FieldLabel htmlFor={`draft-opt-name-${i}`}>Option name</FieldLabel>
                    <Input
                      id={`draft-opt-name-${i}`}
                      value={opt.name}
                      placeholder="e.g. Size"
                      maxLength={40}
                      onChange={(e) => changeOptions(options.map((o, j) => (j === i ? { ...o, name: e.target.value } : o)))}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <FieldLabel>
                      Values ({opt.values.length} of {MAX_VALUES})
                    </FieldLabel>
                    <ValueChips
                      label={`Values for ${opt.name || "option"}`}
                      values={opt.values}
                      onChange={(next) => changeOptions(options.map((o, j) => (j === i ? { ...o, values: next } : o)))}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive sm:mt-6"
                    onClick={() => changeOptions(options.filter((_, j) => j !== i))}
                    aria-label={`Remove option ${opt.name || i + 1}`}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </div>
              ))}
              {preview.error ? (
                <p className="text-xs font-medium text-destructive" role="alert">
                  {preview.error}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {variants.length} variant{variants.length === 1 ? "" : "s"} from these options. Limit {MAX_VARIANTS}.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No options yet. This product is sold as a single version. Add an option to create variants.</p>
          )}
        </section>

        <section className="grid gap-3" aria-label="Variants">
          <h3 className="text-sm font-semibold text-foreground">Variants ({variants.length})</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Variant</TableHead>
                  <TableHead className="min-w-36">SKU *</TableHead>
                  <TableHead className="min-w-28">Price ({sym}) *</TableHead>
                  <TableHead className="min-w-28">Compare-at ({sym})</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((v, i) => (
                  <TableRow key={v.key}>
                    <TableCell className="text-sm font-medium text-foreground">{v.title}</TableCell>
                    <TableCell className="align-top">
                      <Input
                        aria-label={`SKU for ${v.title}`}
                        value={v.sku}
                        placeholder="e.g. DENIM-JKT-01"
                        onChange={(e) => patchVariant(v.key, { sku: e.target.value })}
                        aria-invalid={Boolean(errors[`variant-sku-${i}`])}
                      />
                      {fieldError(`variant-sku-${i}`)}
                    </TableCell>
                    <TableCell className="align-top">
                      <Input
                        aria-label={`Price for ${v.title}`}
                        type="number"
                        step="0.01"
                        min="0"
                        disabled={priceOnRequest}
                        value={priceOnRequest ? "0.00" : v.price}
                        placeholder="0.00"
                        onChange={(e) => patchVariant(v.key, { price: e.target.value })}
                        aria-invalid={Boolean(errors[`variant-price-${i}`])}
                      />
                      {fieldError(`variant-price-${i}`)}
                    </TableCell>
                    <TableCell className="align-top">
                      <Input
                        aria-label={`Compare-at price for ${v.title}`}
                        type="number"
                        step="0.01"
                        min="0"
                        disabled={priceOnRequest}
                        value={priceOnRequest ? "" : v.compareAtPrice}
                        placeholder="0.00"
                        onChange={(e) => patchVariant(v.key, { compareAtPrice: e.target.value })}
                        aria-invalid={Boolean(errors[`variant-compare-${i}`])}
                      />
                      {fieldError(`variant-compare-${i}`)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">Weight, barcode, images and stock rules can be set per variant after the product is saved.</p>
        </section>
      </CardContent>
    </Card>
  );
}
