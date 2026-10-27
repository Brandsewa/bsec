import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { Alert } from "@bs/ui";
import { Button } from "@bs/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { Checkbox } from "@bs/ui";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@bs/ui";
import { Input } from "@bs/ui";
import { orpc } from "../../lib/orpc.ts";
import type { client } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { SimpleSelect } from "@bs/ui";

export const Route = createFileRoute("/_store/discounts_/$id")({
  pendingComponent: () => <PageSkeleton />,
  component: EditDiscountPage,
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

/** ISO string -> the value a datetime-local input wants (local time, minutes). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EditDiscountPage() {
  const { id } = Route.useParams();
  const query = useQuery(orpc.admin.discounts.get.queryOptions({ input: { id } }));
  if (query.isLoading) return <PageSkeleton />;
  if (query.isError || !query.data) {
    return (
      <PageContainer>
        <PageHeader back={{ href: "/discounts", label: "Discounts" }} title="Discount not found" />
        <Alert variant="destructive">{errorMessage(query.error)}</Alert>
      </PageContainer>
    );
  }
  return <EditDiscountForm discount={query.data} />;
}

type LoadedDiscount = Awaited<ReturnType<typeof client.admin.discounts.get>>;

function EditDiscountForm({ discount }: { discount: LoadedDiscount }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const initialType = (discount.type === "buy_x_get_y" ? "percent" : discount.type) as DiscountType;
  const [code, setCode] = useState(discount.code ?? "");
  const [title, setTitle] = useState(discount.title);
  const [type, setType] = useState<DiscountType>(initialType);
  const [value, setValue] = useState(String(initialType === "fixed" ? discount.value / 100 : discount.value));
  const [minSubtotal, setMinSubtotal] = useState(discount.minSubtotal ? String(discount.minSubtotal / 100) : "");
  const [usageLimit, setUsageLimit] = useState(discount.usageLimit ? String(discount.usageLimit) : "");
  const [perCustomerLimit, setPerCustomerLimit] = useState(discount.perCustomerLimit ? String(discount.perCustomerLimit) : "");
  const [combinable, setCombinable] = useState(discount.combinable);
  const [showOnStorefront, setShowOnStorefront] = useState(discount.showOnStorefront);
  const [startsAt, setStartsAt] = useState(toLocalInput(discount.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(discount.endsAt));
  const archived = discount.status === "archived";

  const create = useMutation(
    orpc.admin.discounts.update.mutationOptions({
      onSuccess: () => {
        toast.success(`Discount ${code || title} saved.`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.discounts.key() });
        void navigate({ to: "/discounts" });
      },
    }),
  );
  const toggleArchive = useMutation(
    orpc.admin.discounts.update.mutationOptions({
      onSuccess: () => {
        toast.success(archived ? "Discount restored." : "Discount archived.");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.discounts.key() });
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
      id: discount.id,
      code: code.trim() ? code.trim() : null,
      title: title.trim(),
      type,
      // percent is a whole percentage; fixed is entered in rupees and stored in paise
      value: type === "free_shipping" ? 0 : type === "fixed" ? Math.round(numValue * 100) : Math.round(numValue),
      minSubtotal: min ? min * 100 : 0,
      usageLimit: total ? total : null,
      perCustomerLimit: per ? per : null,
      combinable,
      showOnStorefront: code.trim() ? showOnStorefront : false,
      startsAt: toIso(startsAt) ?? null,
      endsAt: toIso(endsAt) ?? null,
    });
  }

  return (
    <PageContainer>
      <PageHeader back={{ href: "/discounts", label: "Discounts" }} title="Edit discount" description={`${discount.usedCount} ${discount.usedCount === 1 ? "use" : "uses"} so far. Changes apply to new orders only.`} />

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
                {create.isPending ? "Saving..." : "Save changes"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={toggleArchive.isPending}
                onClick={() => toggleArchive.mutate({ id: discount.id, status: archived ? "active" : "archived" })}
              >
                {archived ? "Restore discount" : "Archive discount"}
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
