import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Alert, Button, EmptyState, Field, Input, PageSkeleton, SimpleSelect, toast } from "@bs/ui";
import { formatMoney } from "@bs/contracts/money";
import type { ProductStatePricing } from "@bs/contracts";
import { SettingsCard, SettingsPageFrame } from "../../../components/settings/settings-page.tsx";
import { client, orpc } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { useStoreCurrency } from "../../../lib/use-store-currency.ts";

export const Route = createFileRoute("/_store/settings/apps_/state-pricing")({
  pendingComponent: () => <PageSkeleton />,
  component: StatePricingPage,
});

const TITLE = "State prices";
const DESCRIPTION = "Pick a product and give any of its variants a different price in a state. Every other state pays the normal price.";

/** "1,299.50" typed by the merchant -> 129950 paise. null when empty or not a positive amount. */
function toMinor(text: string): number | null {
  const n = Number(text.replace(/,/g, "").trim());
  if (!text.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}
const toMajor = (minor: number) => String(minor / 100);

function StatePricingPage() {
  const currency = useStoreCurrency();
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState<string | null>(null);

  const states = useQuery(orpc.admin.apps.states.queryOptions());
  const products = useQuery(orpc.admin.products.list.queryOptions({ input: { limit: 8, ...(search.trim() ? { search: search.trim() } : {}) } }));
  const pricing = useQuery({ ...orpc.admin.apps.getProductPricing.queryOptions({ input: { productId: productId ?? "" } }), enabled: productId !== null });

  return (
    <SettingsPageFrame title={TITLE} description={DESCRIPTION}>
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/settings/apps">
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back to Apps
          </Link>
        </Button>
      </div>

      <SettingsCard title="Choose a product">
        <Field id="state-pricing-search" label="Search products">
          <Input id="state-pricing-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Product name" />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          {(products.data?.items ?? []).map((p) => (
            <Button key={p.id} size="sm" variant={p.id === productId ? "default" : "outline"} onClick={() => setProductId(p.id)}>
              {p.title}
            </Button>
          ))}
          {products.data && products.data.items.length === 0 ? <p className="text-sm text-muted-foreground">No products match.</p> : null}
        </div>
      </SettingsCard>

      {productId === null ? null : pricing.isLoading || states.isLoading ? (
        <PageSkeleton />
      ) : pricing.isError || !pricing.data || !states.data ? (
        <Alert role="alert">{errorMessage(pricing.error ?? states.error)}</Alert>
      ) : (
        <ProductEditor
          key={pricing.data.productId}
          data={pricing.data}
          states={states.data}
          currency={currency}
          onSaved={() => void pricing.refetch()}
        />
      )}
    </SettingsPageFrame>
  );
}

interface EditorProps {
  data: ProductStatePricing;
  states: { code: string; name: string }[];
  currency: string;
  onSaved: () => void;
}

function ProductEditor({ data, states, currency, onSaved }: EditorProps) {
  return (
    <>
      {data.variants.map((v) => (
        <VariantEditor key={`${v.variantId}:${JSON.stringify(v.prices)}`} variant={v} productTitle={data.productTitle} states={states} currency={currency} onSaved={onSaved} />
      ))}
    </>
  );
}

interface VariantProps {
  variant: EditorProps["data"]["variants"][number];
  productTitle: string;
  states: EditorProps["states"];
  currency: string;
  onSaved: () => void;
}

function VariantEditor({ variant, productTitle, states, currency, onSaved }: VariantProps) {
  const initial = useMemo(() => Object.fromEntries(Object.entries(variant.prices).map(([code, p]) => [code, toMajor(p.price)])), [variant.prices]);
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [newState, setNewState] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const nameOf = (code: string) => states.find((s) => s.code === code)?.name ?? code;
  const available = states.filter((s) => !(s.code in draft));

  function addRow() {
    if (!newState) return;
    if (toMinor(newPrice) === null) {
      toast.error("Enter a price greater than zero");
      return;
    }
    setDraft((d) => ({ ...d, [newState]: newPrice }));
    setNewState("");
    setNewPrice("");
  }

  async function save() {
    const prices: { state: string; price: number | null }[] = [];
    for (const [code, text] of Object.entries(draft)) {
      const minor = toMinor(text);
      if (minor === null) {
        toast.error(`${nameOf(code)}: enter a price greater than zero`);
        return;
      }
      if (variant.prices[code]?.price !== minor) prices.push({ state: code, price: minor });
    }
    for (const code of Object.keys(variant.prices)) if (!(code in draft)) prices.push({ state: code, price: null });
    if (prices.length === 0) {
      toast.success("Nothing to save");
      return;
    }
    setSaving(true);
    try {
      await client.admin.apps.setVariantPricing({ variantId: variant.variantId, prices });
      toast.success("State prices saved");
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const title = variant.title === "Default" ? productTitle : `${productTitle}: ${variant.title}`;

  return (
    <SettingsCard title={title} description={`Normal price ${formatMoney(variant.basePrice, currency)}${variant.sku ? ` · SKU ${variant.sku}` : ""}`}>
      {Object.keys(draft).length === 0 ? (
        <EmptyState title="Same price everywhere" description="Add a state below to charge something different there." />
      ) : (
        <div className="space-y-2">
          {Object.entries(draft)
            .sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b)))
            .map(([code, text]) => (
              <div key={code} className="flex items-center gap-2">
                <span className="w-56 truncate text-sm text-foreground">{nameOf(code)}</span>
                <Input
                  aria-label={`${nameOf(code)} price`}
                  inputMode="decimal"
                  className="w-40"
                  value={text}
                  onChange={(e) => setDraft((d) => ({ ...d, [code]: e.target.value }))}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${nameOf(code)}`}
                  onClick={() =>
                    setDraft((d) => {
                      const { [code]: _removed, ...rest } = d;
                      return rest;
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="w-56">
          <Field id={`add-state-${variant.variantId}`} label="Add a state">
            <SimpleSelect value={newState} onChange={setNewState} options={available.map((s) => ({ value: s.code, label: s.name }))} placeholder="Choose a state" />
          </Field>
        </div>
        <div className="w-40">
          <Field id={`add-price-${variant.variantId}`} label="Price">
            <Input id={`add-price-${variant.variantId}`} inputMode="decimal" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
          </Field>
        </div>
        <Button variant="outline" onClick={addRow} disabled={!newState}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add
        </Button>
      </div>

      <div className="mt-4">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save state prices"}
        </Button>
      </div>
    </SettingsCard>
  );
}
