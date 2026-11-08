import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageContainer, PageHeader, PageSkeleton, InfoTip, toast } from "@bs/ui";
import { currencySymbol } from "@bs/contracts/money";
import { useStoreCurrency } from "../../lib/use-store-currency.ts";
import { Alert } from "@bs/ui";
import { Button } from "@bs/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { Checkbox } from "@bs/ui";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@bs/ui";
import { Input } from "@bs/ui";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { SimpleSelect } from "@bs/ui";
import { DiscountAudienceCard, audienceToApi, audienceValid, emptyAudience, type AudienceState } from "../../components/discount/discount-audience.tsx";
import { DiscountKindCards, DiscountScopeCard, buildSetup, typeForKind, emptyScope, scopeValid, type DiscountKind, type DiscountType, type ScopeState } from "../../components/discount/discount-scope.tsx";

export const Route = createFileRoute("/_store/discounts_/new")({
  pendingComponent: () => <PageSkeleton />,
  component: CreateDiscountPage,
});

const typeLabel = (sym: string): Record<DiscountType, string> => ({
  percent: "Percentage off",
  fixed: `Fixed amount off (${sym})`,
  free_shipping: "Free shipping",
  buy_x_get_y: "Buy X get Y",
  bundle: "Bundle price",
});

/** "" → undefined, otherwise a whole number (or NaN if it isn't one). */
function optionalInt(raw: string): number | undefined {
  return raw.trim() === "" ? undefined : Number(raw);
}

/** datetime-local value → ISO string the API expects. */
function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function CreateDiscountPage() {
  const storeCurrency = useStoreCurrency();
  const sym = currencySymbol(storeCurrency);
  const labels = typeLabel(sym);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DiscountType>("percent");
  const [kind, setKind] = useState<DiscountKind>("order");
  const [audience, setAudience] = useState<AudienceState>(emptyAudience);
  const [codeList, setCodeList] = useState(false);
  const [scope, setScope] = useState<ScopeState>(emptyScope);
  const [value, setValue] = useState("10");
  const [minSubtotal, setMinSubtotal] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [perCustomerLimit, setPerCustomerLimit] = useState("");
  const [combinable, setCombinable] = useState(false);
  const [showOnStorefront, setShowOnStorefront] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const create = useMutation(
    orpc.admin.discounts.create.mutationOptions({
      onSuccess: (res) => {
        toast.success(`Discount ${res.code ?? res.title} created.`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.discounts.list.key() });
        // A list of single-use codes is made on the discount's own page, now that it exists.
        if (codeList) void navigate({ to: "/discounts/$id", params: { id: res.id } });
        else void navigate({ to: "/discounts" });
      },
    }),
  );


  function pickKind(k: DiscountKind) {
    setKind(k);
    setType(typeForKind(k, type));
  }

  const numValue = Number(value);
  const valueOk = type === "free_shipping" || type === "buy_x_get_y" || type === "bundle" || scope.tiersOn || (Number.isFinite(numValue) && numValue > 0 && (type !== "percent" || numValue <= 100));
  const intsOk = [minSubtotal, usageLimit, perCustomerLimit].every((r) => {
    const n = optionalInt(r);
    return n === undefined || (Number.isInteger(n) && n >= 0);
  });
  const datesOk = !startsAt || !endsAt || new Date(endsAt) > new Date(startsAt);
  const ready = title.trim() !== "" && valueOk && intsOk && datesOk && scopeValid(kind, type, scope) && audienceValid(audience) && (audience.type === "all" || codeList || code.trim() !== "");

  function submit() {
    if (!ready) return;
    const min = optionalInt(minSubtotal);
    const total = optionalInt(usageLimit);
    const per = optionalInt(perCustomerLimit);
    create.mutate({
      ...(!codeList && code.trim() ? { code: code.trim() } : {}),
      ...(codeList ? { usesCodeList: true } : {}),
      customerEligibility: audienceToApi(audience),
      title: title.trim(),
      type,
      // percent is a whole percentage; fixed is entered in rupees and stored in paise
      value: type === "free_shipping" || type === "buy_x_get_y" || type === "bundle" ? 0 : type === "fixed" ? Math.round(numValue * 100) : Math.round(numValue),
      ...buildSetup(kind, type, scope),
      ...(min ? { minSubtotal: min * 100 } : {}),
      ...(total ? { usageLimit: total } : {}),
      ...(per ? { perCustomerLimit: per } : {}),
      combinable,
      showOnStorefront: !codeList && code.trim() ? showOnStorefront : false,
      ...(toIso(startsAt) ? { startsAt: toIso(startsAt) as string } : {}),
      ...(toIso(endsAt) ? { endsAt: toIso(endsAt) as string } : {}),
    });
  }

  return (
    <PageContainer>
      <PageHeader back={{ href: "/discounts", label: "Discounts" }} title="Create discount" description="Set up a coupon code or an automatic discount for your storefront." />

      <form
        className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4">
          <DiscountKindCards kind={kind} onChange={pickKind} />

          <Card>
            <CardHeader>
              <CardTitle>Discount</CardTitle>
              <CardDescription>Leave the code empty to apply the discount automatically.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                {codeList ? null : (
                <Field>
                  <FieldLabel htmlFor="discount-code">Discount code</FieldLabel>
                  <Input
                    id="discount-code"
                    className="font-mono uppercase"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ""))}
                    placeholder="e.g. SUMMER50"
                  />
                </Field>
                )}
                <Field orientation="horizontal">
                  <Checkbox id="discount-code-list" checked={codeList} onCheckedChange={(c) => setCodeList(c === true)} />
                  <FieldLabel htmlFor="discount-code-list" className="font-normal">
                    Make a list of single-use codes instead (for influencers or campaigns)
                  </FieldLabel>
                </Field>
                <Field>
                  <FieldLabel htmlFor="discount-title">Title</FieldLabel>
                  <Input id="discount-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Summer flat 20% off" />
                  <FieldDescription>Shown to you and on the order, not to customers.</FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Value</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                {kind === "bxgy" || kind === "bundle" ? null : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <div className="flex items-center gap-1.5">
                      <FieldLabel htmlFor="discount-type">Type</FieldLabel>
                      {type === "fixed" ? (
                        <InfoTip>Fixed-amount discounts only apply to orders placed in the store's base currency ({storeCurrency}).</InfoTip>
                      ) : null}
                    </div>
                    <SimpleSelect
                      id="discount-type"
                      value={type}
                      onChange={(v) => setType(v as DiscountType)}
                      options={(kind === "shipping" ? (["free_shipping"] as DiscountType[]) : (["percent", "fixed"] as DiscountType[])).map((t) => ({ value: t, label: labels[t] }))}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="discount-value">Value ({type === "percent" ? "%" : sym})</FieldLabel>
                    <Input
                      id="discount-value"
                      type="number"
                      min={type === "percent" ? 1 : 0}
                      max={type === "percent" ? 100 : undefined}
                      step={type === "fixed" ? "0.01" : "1"}
                      disabled={type === "free_shipping" || scope.tiersOn}
                      value={type === "free_shipping" ? "" : value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </Field>
                </div>
                )}
                <Field>
                  <FieldLabel htmlFor="discount-min">Minimum order value ({sym}, optional)</FieldLabel>
                  <Input id="discount-min" type="number" min={0} step="1" value={minSubtotal} onChange={(e) => setMinSubtotal(e.target.value)} placeholder="No minimum" />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <DiscountScopeCard kind={kind} type={type} sym={sym} scope={scope} onChange={setScope} />

          <DiscountAudienceCard audience={audience} onChange={setAudience} hasCode={codeList || code.trim() !== ""} />

          <Card>
            <CardHeader>
              <CardTitle>Usage limits</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="discount-limit">Total uses (optional)</FieldLabel>
                    <Input id="discount-limit" type="number" min={1} step="1" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} placeholder="Unlimited" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="discount-per-customer">Per customer (optional)</FieldLabel>
                    <Input id="discount-per-customer" type="number" min={1} step="1" value={perCustomerLimit} onChange={(e) => setPerCustomerLimit(e.target.value)} placeholder="Unlimited" />
                  </Field>
                </div>
                <Field orientation="horizontal">
                  <Checkbox id="discount-combinable" checked={combinable} onCheckedChange={(c) => setCombinable(c)} />
                  <FieldLabel htmlFor="discount-combinable" className="font-normal">
                    Can be combined with a free-shipping or order discount
                  </FieldLabel>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox id="discount-showcase" checked={showOnStorefront} disabled={!code.trim()} onCheckedChange={(c) => setShowOnStorefront(c)} />
                  <FieldLabel htmlFor="discount-showcase" className="font-normal">
                    Show on the storefront (coupon cards on product pages)
                  </FieldLabel>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Schedule</CardTitle>
              <CardDescription>Optional. Leave blank to start now and never expire.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="discount-start">Starts</FieldLabel>
                  <Input id="discount-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="discount-end">Ends</FieldLabel>
                  <Input id="discount-end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </Field>
              </div>
              {!datesOk ? <p className="mt-2 text-destructive">The end date must be after the start date.</p> : null}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="font-mono font-semibold text-foreground">{code || "Automatic discount"}</p>
              <p className="text-muted-foreground">
                {kind === "products"
                  ? scope.target === "products"
                    ? `On ${scope.products.length} chosen product${scope.products.length === 1 ? "" : "s"}`
                    : `On ${scope.collectionIds.length} chosen collection${scope.collectionIds.length === 1 ? "" : "s"}`
                  : kind === "order"
                    ? "On the whole order"
                    : kind === "shipping"
                      ? "On the shipping charge"
                      : "Chosen in the offer"}
              </p>
              <p className="text-muted-foreground">
                {type === "free_shipping"
                  ? "Free shipping"
                  : type === "buy_x_get_y"
                    ? "Buy X get Y"
                    : type === "bundle"
                      ? "Bundle price"
                      : type === "percent"
                        ? `${value || 0}% off`
                        : `${sym}${value || 0} off`}
                {minSubtotal ? ` on orders over ${sym}${minSubtotal}` : ""}
                {usageLimit ? `, first ${usageLimit} uses` : ""}.
              </p>
              {create.isError ? <Alert variant="destructive">{errorMessage(create.error)}</Alert> : null}
              <Button type="submit" size="lg" disabled={!ready || create.isPending}>
                {create.isPending ? "Saving..." : "Save discount"}
              </Button>
              <Button type="button" variant="ghost" size="sm" nativeButton={false} render={<Link to="/discounts" />}>
                Cancel
              </Button>
            </CardContent>
          </Card>
        </div>
      </form>
    </PageContainer>
  );
}
