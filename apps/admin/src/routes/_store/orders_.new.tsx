import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { INDIAN_STATES } from "../../lib/india.ts";
import { money } from "../../components/order-parts.tsx";
import { SimpleSelect } from "../../components/simple-select.tsx";

export const Route = createFileRoute("/_store/orders_/new")({
  pendingComponent: () => <PageSkeleton />,
  component: CreateOrderPage,
});

interface Line {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  price: number;
  quantity: number;
}

/** One search hit; loads its variants only when opened. */
function ProductResult({ id, title, onAdd }: { id: string; title: string; onAdd: (l: Omit<Line, "quantity">) => void }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery(orpc.admin.products.get.queryOptions({ input: { id }, enabled: open }));
  return (
    <div className="rounded-md border border-border">
      <button type="button" className="flex w-full items-center justify-between gap-2 p-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="font-medium text-foreground">{title}</span>
        <span className="text-muted-foreground">{open ? "Hide variants" : "Choose variant"}</span>
      </button>
      {open ? (
        <div className="grid gap-1 border-t border-border p-2">
          {detail.isLoading ? <p className="p-2 text-muted-foreground">Loading variants...</p> : null}
          {detail.data?.variants.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-md p-2 hover:bg-muted">
              <div>
                <p className="text-foreground">{v.title}</p>
                <p className="text-muted-foreground">{v.sku} · {money(v.price)}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => onAdd({ variantId: v.id, productTitle: title, variantTitle: v.title, price: v.price })}>
                <Plus className="mr-1" /> Add
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CreateOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  const results = useQuery(
    orpc.admin.products.list.queryOptions({ input: { status: "active", limit: 8, ...(search.trim() ? { search: search.trim() } : {}) } }),
  );

  const create = useMutation(
    orpc.admin.orders.createDraft.mutationOptions({
      onSuccess: (res) => {
        toast.success(`Draft order ${res.orderNumber} created.`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.orders.list.key() });
        void navigate({ to: "/orders/$orderId", params: { orderId: res.orderId } });
      },
    }),
  );

  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const ready = email.trim() && phone.trim().length >= 5 && fullName.trim() && addressLine1.trim() && city.trim() && state && /^\d{6}$/.test(pincode) && lines.length > 0;

  function addLine(l: Omit<Line, "quantity">) {
    setLines((cur) => {
      const found = cur.find((x) => x.variantId === l.variantId);
      return found ? cur.map((x) => (x.variantId === l.variantId ? { ...x, quantity: x.quantity + 1 } : x)) : [...cur, { ...l, quantity: 1 }];
    });
  }
  function setQty(variantId: string, quantity: number) {
    setLines((cur) => (quantity < 1 ? cur.filter((x) => x.variantId !== variantId) : cur.map((x) => (x.variantId === variantId ? { ...x, quantity } : x))));
  }

  function submit() {
    if (!ready) return;
    create.mutate({
      email: email.trim(),
      phone: phone.trim(),
      shippingAddress: {
        fullName: fullName.trim(),
        addressLine1: addressLine1.trim(),
        ...(addressLine2.trim() ? { addressLine2: addressLine2.trim() } : {}),
        city: city.trim(),
        state,
        pincode,
        country: "IN",
      },
      items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    });
  }

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Orders", href: "/orders" }, { label: "Create order" }]} />
      <PageHeader title="Create order" description="Build an order for a customer without storefront checkout. Shipping, tax and the pay link are worked out when you create it." />

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
              <CardTitle>Products</CardTitle>
              <CardDescription>Search active products and add the variants to order.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input aria-label="Search products" className="pl-8" placeholder="Search products..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="grid gap-2">
                {results.data?.items.length === 0 ? <p className="text-muted-foreground">No active products match.</p> : null}
                {results.data?.items.map((p) => (
                  <ProductResult key={p.id} id={p.id} title={p.title} onAdd={addLine} />
                ))}
              </div>

              {lines.length > 0 ? (
                <div className="grid gap-2" aria-label="Order items">
                  <p className="text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">In this order</p>
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {lines.map((l) => (
                      <div key={l.variantId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                        <div>
                          <p className="font-medium text-foreground">{l.productTitle}</p>
                          <p className="text-muted-foreground">{l.variantTitle} · {money(l.price)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button type="button" variant="outline" size="icon" aria-label={`Decrease ${l.productTitle} quantity`} onClick={() => setQty(l.variantId, l.quantity - 1)}>
                            <Minus />
                          </Button>
                          <span className="w-6 text-center tabular-nums" aria-live="polite">{l.quantity}</span>
                          <Button type="button" variant="outline" size="icon" aria-label={`Increase ${l.productTitle} quantity`} onClick={() => setQty(l.variantId, l.quantity + 1)}>
                            <Plus />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${l.productTitle}`} onClick={() => setQty(l.variantId, 0)}>
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer and shipping</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="order-email">Customer email</FieldLabel>
                    <Input id="order-email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="order-phone">Phone number</FieldLabel>
                    <Input id="order-phone" type="tel" required autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
                    <FieldDescription>Include the country code.</FieldDescription>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="order-name">Full name</FieldLabel>
                  <Input id="order-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="order-line1">Address</FieldLabel>
                  <Input id="order-line1" required value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="order-line2">Apartment, suite, etc. (optional)</FieldLabel>
                  <Input id="order-line2" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="order-city">City</FieldLabel>
                    <Input id="order-city" required value={city} onChange={(e) => setCity(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="order-state">State</FieldLabel>
                    <SimpleSelect
                      id="order-state"
                      value={state}
                      onChange={setState}
                      placeholder="Select state"
                      options={INDIAN_STATES.map((s) => ({ value: s, label: s }))}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="order-pincode">PIN code</FieldLabel>
                    <Input id="order-pincode" required inputMode="numeric" maxLength={6} pattern="\d{6}" value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))} />
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Items</span>
                <span className="text-foreground">{lines.reduce((n, l) => n + l.quantity, 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="text-sm font-semibold text-foreground">{money(subtotal)}</span>
              </div>
              <p className="text-muted-foreground">Shipping, tax and COD fees are added when the order is created.</p>
              {create.isError ? <Alert variant="destructive">{errorMessage(create.error)}</Alert> : null}
              <Button type="submit" size="lg" disabled={!ready || create.isPending}>
                {create.isPending ? "Creating..." : "Create order"}
              </Button>
              <Button type="button" variant="ghost" size="sm" nativeButton={false} render={<Link to="/orders" />}>
                Cancel
              </Button>
            </CardContent>
          </Card>
        </div>
      </form>
    </PageContainer>
  );
}
