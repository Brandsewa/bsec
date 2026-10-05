import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { Alert } from "@bs/ui";
import { Button } from "@bs/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { Checkbox } from "@bs/ui";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@bs/ui";
import { Input } from "@bs/ui";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { SimpleSelect } from "@bs/ui";

export const Route = createFileRoute("/_store/discounts_/new")({
  pendingComponent: () => <PageSkeleton />,
  component: CreateDiscountPage,
});

type DiscountType = "percent" | "fixed" | "free_shipping";

const TYPE_LABEL: Record<DiscountType, string> = {
  percent: "Percentage off",
  fixed: "Fixed amount off (₹)",
  free_shipping: "Free shipping",
};

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DiscountType>("percent");
  const [value, setValue] = useState("10");
  const [minSubtotal, setMinSubtotal] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [perCustomerLimit, setPerCustomerLimit] = useState("");
  const [combinable, setCombinable] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const create = useMutation(
    orpc.admin.discounts.create.mutationOptions({
      onSuccess: (res) => {
        toast.success(`Discount ${res.code ?? res.title} created.`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.discounts.list.key() });
        void navigate({ to: "/discounts" });
      },
    }),
  );

  const numValue = Number(value);
  const valueOk = type === "free_shipping" || (Number.isFinite(numValue) && numValue > 0 && (type !== "percent" || numValue <= 100));
  const intsOk = [minSubtotal, usageLimit, perCustomerLimit].every((r) => {
    const n = optionalInt(r);
    return n === undefined || (Number.isInteger(n) && n >= 0);
  });
  const datesOk = !startsAt || !endsAt || new Date(endsAt) > new Date(startsAt);
  const ready = title.trim() !== "" && valueOk && intsOk && datesOk;

  function submit() {
    if (!ready) return;
    const min = optionalInt(minSubtotal);
    const total = optionalInt(usageLimit);
    const per = optionalInt(perCustomerLimit);
    create.mutate({
      ...(code.trim() ? { code: code.trim() } : {}),
      title: title.trim(),
      type,
      // percent is a whole percentage; fixed is entered in rupees and stored in paise
      value: type === "free_shipping" ? 0 : type === "fixed" ? Math.round(numValue * 100) : Math.round(numValue),
      ...(min ? { minSubtotal: min * 100 } : {}),
      ...(total ? { usageLimit: total } : {}),
      ...(per ? { perCustomerLimit: per } : {}),
      combinable,
      ...(toIso(startsAt) ? { startsAt: toIso(startsAt) as string } : {}),
      ...(toIso(endsAt) ? { endsAt: toIso(endsAt) as string } : {}),
    });
  }

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Discounts", href: "/discounts" }, { label: "Create discount" }]} />
      <PageHeader title="Create discount" description="Set up a coupon code or an automatic discount for your storefront." />

      <form
        className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Discount</CardTitle>
              <CardDescription>Leave the code empty to apply the discount automatically.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
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
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="discount-type">Type</FieldLabel>
                    <SimpleSelect
                      id="discount-type"
                      value={type}
                      onChange={(v) => setType(v as DiscountType)}
                      options={(Object.keys(TYPE_LABEL) as DiscountType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="discount-value">Value ({type === "percent" ? "%" : "₹"})</FieldLabel>
                    <Input
                      id="discount-value"
                      type="number"
                      min={type === "percent" ? 1 : 0}
                      max={type === "percent" ? 100 : undefined}
                      step={type === "fixed" ? "0.01" : "1"}
                      disabled={type === "free_shipping"}
                      value={type === "free_shipping" ? "" : value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="discount-min">Minimum order value (₹, optional)</FieldLabel>
                  <Input id="discount-min" type="number" min={0} step="1" value={minSubtotal} onChange={(e) => setMinSubtotal(e.target.value)} placeholder="No minimum" />
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

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
                    Can be combined with other discounts
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
                {type === "free_shipping"
                  ? "Free shipping"
                  : type === "percent"
                    ? `${value || 0}% off`
                    : `₹${value || 0} off`}
                {minSubtotal ? ` on orders over ₹${minSubtotal}` : ""}
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
