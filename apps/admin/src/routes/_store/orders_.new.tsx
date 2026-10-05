import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Minus,
  Plus,
  Search,
  Trash2,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { Alert } from "@bs/ui";
import { Badge } from "@bs/ui";
import { Button } from "@bs/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { Checkbox } from "@bs/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bs/ui";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@bs/ui";
import { Input } from "@bs/ui";
import { RadioGroup, RadioGroupItem } from "@bs/ui";
import { Textarea } from "@bs/ui";
import { orpc } from "../../lib/orpc.ts";
import { errorMessage } from "../../lib/errors.ts";
import { INDIAN_STATES } from "../../lib/india.ts";
import { money } from "../../components/order-parts.tsx";
import { SimpleSelect } from "@bs/ui";

export interface CreateOrderSearch {
  quoteId?: string | undefined;
}

export const Route = createFileRoute("/_store/orders_/new")({
  validateSearch: (raw: Record<string, unknown>): CreateOrderSearch => ({
    quoteId: typeof raw["quoteId"] === "string" ? raw["quoteId"] : undefined,
  }),
  pendingComponent: () => <PageSkeleton />,
  component: CreateOrderPage,
});

interface Line {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  originalPrice: number;
  effectivePrice: number;
  priceOverride?: number | undefined;
  priceOverrideReason?: string | undefined;
  quantity: number;
  trackInventory?: boolean;
}

interface SelectedCustomer {
  id: string;
  name: string;
  email: string;
  phone?: string | null | undefined;
}

/** One product search hit; loads its variants only when opened. */
function ProductResult({
  id,
  title,
  onAdd,
}: {
  id: string;
  title: string;
  onAdd: (l: Omit<Line, "quantity" | "effectivePrice">) => void;
}) {
  const [open, setOpen] = useState(false);
  const detail = useQuery(orpc.admin.products.get.queryOptions({ input: { id }, enabled: open }));

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 p-3 text-left transition-colors hover:bg-muted/50"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{open ? "Hide variants" : "Choose variant"}</span>
      </button>
      {open ? (
        <div className="grid gap-1 border-t border-border p-2">
          {detail.isLoading ? <p className="p-2 text-xs text-muted-foreground">Loading variants...</p> : null}
          {detail.data?.variants.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-md p-2 hover:bg-muted">
              <div>
                <p className="text-sm font-medium text-foreground">{v.title}</p>
                <p className="text-xs text-muted-foreground">
                  {v.sku} · {money(v.price)}
                  {v.trackInventory ? " · Tracked" : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() =>
                  onAdd({
                    variantId: v.id,
                    productTitle: title,
                    variantTitle: v.title,
                    originalPrice: v.price,
                    trackInventory: v.trackInventory,
                  })
                }
              >
                <Plus className="mr-1 size-3.5" /> Add
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Dialog for inline customer creation (D6) */
function CreateCustomerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (
    customer: SelectedCustomer,
    address?: { fullName: string; line1: string; line2?: string | undefined; city: string; state: string; pincode: string } | undefined,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [tags, setTags] = useState("");
  const [note, setNote] = useState("");

  const createCustomer = useMutation(
    orpc.admin.customers.create.mutationOptions({
      onSuccess: (res) => {
        toast.success(`Customer ${res.customer.name || res.customer.email} created`);
        const hasAddr = line1.trim() && city.trim() && state.trim() && pincode.trim();
        onCreated(
          {
            id: res.customer.id,
            name: res.customer.name,
            email: res.customer.email,
            phone: res.customer.phone,
          },
          hasAddr
            ? {
                fullName: name.trim(),
                line1: line1.trim(),
                line2: line2.trim() || undefined,
                city: city.trim(),
                state: state.trim(),
                pincode: pincode.trim(),
              }
            : undefined,
        );
        onOpenChange(false);
      },
    }),
  );

  const canSave = name.trim() && email.trim() && (!pincode || /^\d{6}$/.test(pincode));

  function handleSave() {
    if (!canSave) return;
    const parsedTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const hasAddr = line1.trim() && city.trim() && state.trim() && pincode.trim();

    createCustomer.mutate({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
      note: note.trim() || undefined,
      address: hasAddr
        ? {
            name: name.trim() || undefined,
            phone: phone.trim() || undefined,
            line1: line1.trim(),
            line2: line2.trim() || undefined,
            city: city.trim(),
            stateCode: state.trim(),
            pincode: pincode.trim(),
          }
        : undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>Add a customer record to this store.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          {createCustomer.isError ? <Alert variant="destructive">{errorMessage(createCustomer.error)}</Alert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="dlg-cust-name">Full name *</FieldLabel>
              <Input id="dlg-cust-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aarav Sharma" />
            </Field>
            <Field>
              <FieldLabel htmlFor="dlg-cust-email">Email *</FieldLabel>
              <Input id="dlg-cust-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="aarav@example.com" />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="dlg-cust-phone">Phone number</FieldLabel>
            <Input id="dlg-cust-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
          </Field>

          <p className="mt-2 text-xs font-semibold text-muted-foreground uppercase">Default address (optional)</p>
          <Field>
            <FieldLabel htmlFor="dlg-cust-addr1">Address line 1</FieldLabel>
            <Input id="dlg-cust-addr1" value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Flat 402, Greenfield Apts" />
          </Field>
          <Field>
            <FieldLabel htmlFor="dlg-cust-addr2">Address line 2</FieldLabel>
            <Input id="dlg-cust-addr2" value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="MG Road, Sector 14" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="dlg-cust-city">City</FieldLabel>
              <Input id="dlg-cust-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Bengaluru" />
            </Field>
            <Field>
              <FieldLabel htmlFor="dlg-cust-state">State</FieldLabel>
              <SimpleSelect
                id="dlg-cust-state"
                value={state}
                onChange={setState}
                placeholder="Select state"
                options={INDIAN_STATES.map((s) => ({ value: s, label: s }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="dlg-cust-pin">PIN code</FieldLabel>
              <Input
                id="dlg-cust-pin"
                maxLength={6}
                value={pincode}
                onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))}
                placeholder="560001"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="dlg-cust-tags">Tags</FieldLabel>
            <Input id="dlg-cust-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, wholesale (comma-separated)" />
          </Field>
          <Field>
            <FieldLabel htmlFor="dlg-cust-note">Staff note</FieldLabel>
            <Textarea id="dlg-cust-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note about customer" />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSave || createCustomer.isPending} onClick={handleSave}>
            {createCustomer.isPending ? "Saving..." : "Save customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateOrderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { quoteId } = Route.useSearch();

  // Quote prefilling if navigated from Quotes workbench
  const quoteQuery = useQuery(
    orpc.admin.quotes.get.queryOptions({
      input: { id: quoteId ?? "" },
      enabled: Boolean(quoteId),
    }),
  );
  const [quotePrefilled, setQuotePrefilled] = useState(false);

  // Customer state (D6)
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showNewCustomerDialog, setShowNewCustomerDialog] = useState(false);

  // Address & Contacts
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");

  // Product Search & Lines
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  // Manual Discount (D3)
  const [hasDiscount, setHasDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<"flat" | "percent">("flat");
  const [discountValue, setDiscountValue] = useState<string>("");
  const [discountReason, setDiscountReason] = useState("");

  // Shipping Override (D2)
  const [hasShippingOverride, setHasShippingOverride] = useState(false);
  const [shippingOverrideRupees, setShippingOverrideRupees] = useState("");
  const [shippingOverrideReason, setShippingOverrideReason] = useState("");
  const [shippingMethod, setShippingMethod] = useState<string>("");

  // Payment Outcome (D4)
  const [paymentOutcome, setPaymentOutcome] = useState<"paid" | "pending" | "cod">("pending");
  const [paymentReference, setPaymentReference] = useState("");

  // Metadata: Notes & Tags (D5)
  const [notes, setNotes] = useState("");
  const [tagsInput, setTagsInput] = useState("");

  // Store payment config for COD availability
  const paymentStatus = useQuery(orpc.admin.payments.get.queryOptions());
  const isCodEnabled = paymentStatus.data?.cod.enabled ?? false;

  // Search queries
  const productResults = useQuery(
    orpc.admin.products.list.queryOptions({
      input: { status: "active", limit: 8, ...(search.trim() ? { search: search.trim() } : {}) },
    }),
  );

  const customerResults = useQuery(
    orpc.admin.customers.list.queryOptions({
      input: { limit: 5, search: customerSearch.trim() },
      enabled: showCustomerSearch && customerSearch.trim().length > 0,
    }),
  );

  useEffect(() => {
    if (!quoteQuery.data || quotePrefilled) return;
    const q = quoteQuery.data;
    const timer = setTimeout(() => {
      setEmail(q.email);
      setPhone(q.phone ?? "");
      setFullName(q.name);
      if (q.customerId) {
        setSelectedCustomer({
          id: q.customerId,
          name: q.name,
          email: q.email,
          phone: q.phone,
        });
      }
      if (q.variantId) {
        setLines([
          {
            variantId: q.variantId,
            productTitle: q.productTitle,
            variantTitle: q.variantTitle ?? "Default",
            originalPrice: 0,
            effectivePrice: q.quotedTotal ? Math.round(q.quotedTotal / q.quantity) : 0,
            priceOverride: q.quotedTotal ? Math.round(q.quotedTotal / q.quantity) : undefined,
            priceOverrideReason: `Quote ${q.number}`,
            quantity: q.quantity,
          },
        ]);
      }
      if (q.message) {
        setNotes(`Quote request ${q.number}: ${q.message}`);
      }
      setQuotePrefilled(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [quoteQuery.data, quotePrefilled]);

  // Estimate order calculation (D1, D2, D3)
  const numDiscountVal = Number(discountValue) || 0;
  const numShippingOverride = Number(shippingOverrideRupees) || 0;

  const estimateInput = {
    items: lines.map((l) => ({
      variantId: l.variantId,
      quantity: l.quantity,
      ...(l.priceOverride != null ? { unitPriceOverride: l.priceOverride } : {}),
    })),
    shippingAddress: {
      state: state || undefined,
      city: city || undefined,
      pincode: pincode || undefined,
    },
    manualDiscount:
      hasDiscount && numDiscountVal > 0
        ? {
            type: discountType,
            value: discountType === "flat" ? Math.round(numDiscountVal * 100) : numDiscountVal,
          }
        : undefined,
    shippingOverride:
      hasShippingOverride && numShippingOverride >= 0
        ? {
            amount: Math.round(numShippingOverride * 100),
          }
        : undefined,
    shippingMethod: !hasShippingOverride && shippingMethod ? shippingMethod : undefined,
  };

  const estimate = useQuery(
    orpc.admin.orders.estimateDraft.queryOptions({
      input: estimateInput,
      enabled: lines.length > 0,
    }),
  );

  // Create Draft Mutation
  const create = useMutation(
    orpc.admin.orders.createDraft.mutationOptions({
      onSuccess: (res) => {
        toast.success(`Draft order ${res.orderNumber} created.`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.orders.list.key() });
        void navigate({ to: "/orders/$orderId", params: { orderId: res.orderId } });
      },
    }),
  );

  function addLine(l: Omit<Line, "quantity" | "effectivePrice">) {
    setLines((cur) => {
      const found = cur.find((x) => x.variantId === l.variantId);
      return found
        ? cur.map((x) => (x.variantId === l.variantId ? { ...x, quantity: x.quantity + 1 } : x))
        : [
            ...cur,
            {
              ...l,
              quantity: 1,
              effectivePrice: l.originalPrice,
            },
          ];
    });
  }

  function setQty(variantId: string, quantity: number) {
    setLines((cur) =>
      quantity < 1 ? cur.filter((x) => x.variantId !== variantId) : cur.map((x) => (x.variantId === variantId ? { ...x, quantity } : x)),
    );
  }

  function setLinePriceOverride(variantId: string, overrideRupees: string, reason: string) {
    const num = overrideRupees.trim() === "" ? undefined : Math.round(Number(overrideRupees) * 100);
    setLines((cur) =>
      cur.map((x) => {
        if (x.variantId !== variantId) return x;
        if (num === undefined || Number.isNaN(num)) {
          return {
            ...x,
            priceOverride: undefined,
            priceOverrideReason: undefined,
            effectivePrice: x.originalPrice,
          };
        }
        return {
          ...x,
          priceOverride: num,
          priceOverrideReason: reason,
          effectivePrice: num,
        };
      }),
    );
  }

  function selectCustomer(cust: SelectedCustomer) {
    setSelectedCustomer(cust);
    setEmail(cust.email);
    if (cust.phone) setPhone(cust.phone);
    if (cust.name) setFullName(cust.name);
    setShowCustomerSearch(false);
  }

  function clearCustomer() {
    setSelectedCustomer(null);
  }

  // Validation
  const hasLinePriceOverrideError = lines.some(
    (l) => l.priceOverride != null && (!l.priceOverrideReason || !l.priceOverrideReason.trim()),
  );
  const hasDiscountError =
    hasDiscount && (numDiscountVal <= 0 || !discountReason.trim());
  const hasShippingOverrideError =
    hasShippingOverride && (!shippingOverrideReason.trim() || numShippingOverride > 10000);

  const ready =
    email.trim() &&
    phone.trim().length >= 5 &&
    fullName.trim() &&
    addressLine1.trim() &&
    city.trim() &&
    state &&
    /^\d{6}$/.test(pincode) &&
    lines.length > 0 &&
    !hasLinePriceOverrideError &&
    !hasDiscountError &&
    !hasShippingOverrideError;

  function submit() {
    if (!ready) return;

    const parsedTags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    create.mutate({
      customerId: selectedCustomer?.id ?? null,
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
      billingAddress: {
        fullName: fullName.trim(),
        addressLine1: addressLine1.trim(),
        ...(addressLine2.trim() ? { addressLine2: addressLine2.trim() } : {}),
        city: city.trim(),
        state,
        pincode,
        country: "IN",
      },
      items: lines.map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
        ...(l.priceOverride != null ? { unitPriceOverride: l.priceOverride } : {}),
        ...(l.priceOverrideReason ? { unitPriceOverrideReason: l.priceOverrideReason } : {}),
      })),
      manualDiscount:
        hasDiscount && numDiscountVal > 0
          ? {
              type: discountType,
              value: discountType === "flat" ? Math.round(numDiscountVal * 100) : numDiscountVal,
              reason: discountReason.trim(),
            }
          : undefined,
      shippingOverride:
        hasShippingOverride
          ? {
              amount: Math.round(numShippingOverride * 100),
              reason: shippingOverrideReason.trim(),
            }
          : undefined,
      shippingMethod: !hasShippingOverride && shippingMethod ? shippingMethod : undefined,
      paymentOutcome,
      paymentReference: paymentOutcome === "paid" && paymentReference.trim() ? paymentReference.trim() : undefined,
      notes: notes.trim() || undefined,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
      quoteId: quoteId || undefined,
    });
  }

  // Summary computed amounts
  const est = estimate.data;
  const fallbackSubtotal = lines.reduce((sum, l) => sum + l.effectivePrice * l.quantity, 0);
  const displaySubtotal = est?.subtotal ?? fallbackSubtotal;
  const displayDiscount = est?.discountTotal ?? 0;
  const displayShipping = est?.shippingTotal ?? 0;
  const displayTax = est?.tax.totalTax ?? 0;
  const codFeePaise = paymentOutcome === "cod" ? (paymentStatus.data?.cod.feePaise ?? 0) : 0;
  const displayGrandTotal = (est?.grandTotal ?? displaySubtotal) + codFeePaise;

  return (
    <PageContainer>
      <PageBreadcrumbs items={[{ label: "Orders", href: "/orders" }, { label: "Create order" }]} />
      <PageHeader
        title="Create order"
        description="Build an order for a customer without storefront checkout. Full parity with discounts, tax rules, inventory reservation, and payment options."
      />

      <form
        className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4">
          {/* Customer Selection & Inline Creation (D6) */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <User className="size-4" /> Customer
                </CardTitle>
                <CardDescription>Link to an existing customer or create a new guest profile.</CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowNewCustomerDialog(true)}
              >
                <UserPlus className="mr-1.5 size-3.5" /> New customer
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4">
              {selectedCustomer ? (
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground">{selectedCustomer.name || "Customer"}</p>
                      <Badge variant="outline" className="text-[10px]">Linked</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{selectedCustomer.email} {selectedCustomer.phone ? `· ${selectedCustomer.phone}` : ""}</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={clearCustomer}>
                    <X className="mr-1 size-3" /> Change
                  </Button>
                </div>
              ) : (
                <div className="grid gap-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    <Input
                      aria-label="Search existing customers"
                      className="pl-8"
                      placeholder="Search existing customer by name, email or phone..."
                      value={customerSearch}
                      onFocus={() => setShowCustomerSearch(true)}
                      onChange={(e) => {
                        setCustomerSearch(e.target.value);
                        setShowCustomerSearch(true);
                      }}
                    />
                  </div>
                  {showCustomerSearch && customerResults.data && customerResults.data.items.length > 0 ? (
                    <div className="rounded-md border border-border bg-card p-1 shadow-sm">
                      {customerResults.data.items.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex w-full items-center justify-between rounded p-2 text-left text-sm hover:bg-muted"
                          onClick={() => selectCustomer({ id: c.id, name: c.name, email: c.email, phone: c.phone })}
                        >
                          <div>
                            <p className="font-medium text-foreground">{c.name || c.email}</p>
                            <p className="text-xs text-muted-foreground">{c.email} {c.phone ? `· ${c.phone}` : ""}</p>
                          </div>
                          <span className="text-xs text-primary">Select</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Shipping Address Inputs */}
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="order-email">Customer email *</FieldLabel>
                    <Input
                      id="order-email"
                      type="email"
                      required
                      autoComplete="off"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="customer@example.com"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="order-phone">Phone number *</FieldLabel>
                    <Input
                      id="order-phone"
                      type="tel"
                      required
                      autoComplete="off"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+919876543210"
                    />
                    <FieldDescription>Include country code if non-Indian.</FieldDescription>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="order-name">Full recipient name *</FieldLabel>
                  <Input id="order-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="order-line1">Address line 1 *</FieldLabel>
                  <Input id="order-line1" required value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="order-line2">Apartment, suite, etc. (optional)</FieldLabel>
                  <Input id="order-line2" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="order-city">City *</FieldLabel>
                    <Input id="order-city" required value={city} onChange={(e) => setCity(e.target.value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="order-state">State *</FieldLabel>
                    <SimpleSelect
                      id="order-state"
                      value={state}
                      onChange={setState}
                      placeholder="Select state"
                      options={INDIAN_STATES.map((s) => ({ value: s, label: s }))}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="order-pincode">PIN code *</FieldLabel>
                    <Input
                      id="order-pincode"
                      required
                      inputMode="numeric"
                      maxLength={6}
                      pattern="\d{6}"
                      value={pincode}
                      onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))}
                      placeholder="6 digits"
                    />
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          {/* Products Section */}
          <Card>
            <CardHeader>
              <CardTitle>Products</CardTitle>
              <CardDescription>Search catalog and add items. Custom line prices can be overridden with a reason.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  aria-label="Search products"
                  className="pl-8"
                  placeholder="Search products..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                {productResults.data?.items.length === 0 ? <p className="text-xs text-muted-foreground">No active products match.</p> : null}
                {productResults.data?.items.map((p) => (
                  <ProductResult key={p.id} id={p.id} title={p.title} onAdd={addLine} />
                ))}
              </div>

              {/* Line Items List */}
              {lines.length > 0 ? (
                <div className="grid gap-2" aria-label="Order items">
                  <p className="text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">In this order</p>
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {lines.map((l) => (
                      <LineItemRow
                        key={l.variantId}
                        line={l}
                        onSetQty={(qty) => setQty(l.variantId, qty)}
                        onSetPriceOverride={(price, reason) => setLinePriceOverride(l.variantId, price, reason)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Adjustments: Discounts (D3) & Shipping Override (D2) */}
          <Card>
            <CardHeader>
              <CardTitle>Discounts and shipping</CardTitle>
              <CardDescription>Set manual order-level adjustments or choose shipping methods.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {/* Manual Discount (D3) */}
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="chk-discount"
                    checked={hasDiscount}
                    onCheckedChange={(checked) => setHasDiscount(Boolean(checked))}
                  />
                  <label htmlFor="chk-discount" className="text-sm font-medium text-foreground cursor-pointer">
                    Apply manual order discount
                  </label>
                </div>
                {hasDiscount ? (
                  <div className="mt-3 grid gap-3 pl-6 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="discount-type">Discount type</FieldLabel>
                      <SimpleSelect
                        id="discount-type"
                        value={discountType}
                        onChange={(v) => setDiscountType(v as "flat" | "percent")}
                        options={[
                          { value: "flat", label: "Flat amount (₹)" },
                          { value: "percent", label: "Percentage (%)" },
                        ]}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="discount-val">
                        {discountType === "flat" ? "Amount in ₹ *" : "Percentage (%) *"}
                      </FieldLabel>
                      <Input
                        id="discount-val"
                        type="number"
                        min="0"
                        max={discountType === "percent" ? "100" : undefined}
                        value={discountValue}
                        onChange={(e) => setDiscountValue(e.target.value)}
                        placeholder={discountType === "flat" ? "500" : "10"}
                      />
                    </Field>
                    <Field className="sm:col-span-2">
                      <FieldLabel htmlFor="discount-reason">Reason for discount *</FieldLabel>
                      <Input
                        id="discount-reason"
                        required={hasDiscount}
                        value={discountReason}
                        onChange={(e) => setDiscountReason(e.target.value)}
                        placeholder="e.g. VIP goodwill, negotiated phone quote, clearance"
                      />
                      <FieldDescription>Required for financial audit logs.</FieldDescription>
                    </Field>
                  </div>
                ) : null}
              </div>

              {/* Shipping (D2) */}
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="chk-shipping-override"
                    checked={hasShippingOverride}
                    onCheckedChange={(checked) => setHasShippingOverride(Boolean(checked))}
                  />
                  <label htmlFor="chk-shipping-override" className="text-sm font-medium text-foreground cursor-pointer">
                    Override shipping rate (max ₹10,000)
                  </label>
                </div>

                {hasShippingOverride ? (
                  <div className="mt-3 grid gap-3 pl-6 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="ship-override-amount">Custom shipping in ₹ *</FieldLabel>
                      <Input
                        id="ship-override-amount"
                        type="number"
                        min="0"
                        max="10000"
                        value={shippingOverrideRupees}
                        onChange={(e) => setShippingOverrideRupees(e.target.value)}
                        placeholder="0 for free shipping"
                      />
                    </Field>
                    <Field className="sm:col-span-2">
                      <FieldLabel htmlFor="ship-override-reason">Reason for override *</FieldLabel>
                      <Input
                        id="ship-override-reason"
                        required={hasShippingOverride}
                        value={shippingOverrideReason}
                        onChange={(e) => setShippingOverrideReason(e.target.value)}
                        placeholder="e.g. Local pickup, bulk freight waiver, urgent courier charge"
                      />
                      <FieldDescription>Required for financial audit logs.</FieldDescription>
                    </Field>
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2 pl-6">
                    <FieldLabel>Shipping method</FieldLabel>
                    {est?.availableShippingRates && est.availableShippingRates.length > 0 ? (
                      <RadioGroup
                        value={shippingMethod || (est.availableShippingRates[0]?.method ?? "")}
                        onValueChange={setShippingMethod}
                        className="gap-2"
                      >
                        {est.availableShippingRates.map((r) => (
                          <label
                            key={r.method}
                            className="flex cursor-pointer items-center justify-between rounded-md border border-border p-2.5 hover:bg-muted/50"
                          >
                            <div className="flex items-center gap-2">
                              <RadioGroupItem value={r.method} />
                              <span className="text-sm font-medium text-foreground">{r.title}</span>
                              {r.estimatedDays ? <span className="text-xs text-muted-foreground">({r.estimatedDays})</span> : null}
                            </div>
                            <span className="text-sm font-semibold">{money(r.amount)}</span>
                          </label>
                        ))}
                      </RadioGroup>
                    ) : (
                      <p className="text-xs text-muted-foreground">Standard store shipping rates will apply automatically based on address.</p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Payment Outcome Selection (D4) */}
          <Card>
            <CardHeader>
              <CardTitle>Payment terms</CardTitle>
              <CardDescription>Choose how payment is handled for this draft order.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <RadioGroup
                value={paymentOutcome}
                onValueChange={(v) => setPaymentOutcome(v as "paid" | "pending" | "cod")}
                className="gap-3"
              >
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/50">
                  <RadioGroupItem value="pending" className="mt-1" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Payment pending (pay link)</p>
                    <p className="text-xs text-muted-foreground">
                      Creates order as pending. Reserves inventory. Customer receives link to pay online.
                    </p>
                  </div>
                </label>

                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/50">
                  <RadioGroupItem value="paid" className="mt-1" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Payment received (mark paid now)</p>
                    <p className="text-xs text-muted-foreground">
                      Mark as already paid (cash, bank transfer, external POS). Commits inventory and updates customer spend.
                    </p>
                    {paymentOutcome === "paid" ? (
                      <div className="mt-2.5">
                        <Input
                          placeholder="Optional reference / UTR / receipt number"
                          value={paymentReference}
                          onChange={(e) => setPaymentReference(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                    ) : null}
                  </div>
                </label>

                {isCodEnabled ? (
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/50">
                    <RadioGroupItem value="cod" className="mt-1" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Cash on delivery (COD)</p>
                      <p className="text-xs text-muted-foreground">
                        Order will be collected upon delivery. Standard store COD fee applies.
                      </p>
                    </div>
                  </label>
                ) : null}
              </RadioGroup>
            </CardContent>
          </Card>

          {/* Internal Notes & Tags (D5) */}
          <Card>
            <CardHeader>
              <CardTitle>Order notes and tags</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field>
                <FieldLabel htmlFor="order-notes">Staff notes (internal only)</FieldLabel>
                <Textarea
                  id="order-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes for fulfillment or team reference..."
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="order-tags">Order tags</FieldLabel>
                <Input
                  id="order-tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="vip, phone-order, b2b (comma-separated)"
                />
              </Field>
            </CardContent>
          </Card>
        </div>

        {/* Sticky Summary Card */}
        <div className="grid gap-4 lg:sticky lg:top-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Items ({lines.reduce((n, l) => n + l.quantity, 0)})</span>
                <span className="text-foreground">{money(displaySubtotal)}</span>
              </div>

              {displayDiscount > 0 ? (
                <div className="flex items-center justify-between text-sm text-emerald-600 dark:text-emerald-400">
                  <span>Discount</span>
                  <span>- {money(displayDiscount)}</span>
                </div>
              ) : null}

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Shipping</span>
                <span className="text-foreground">{displayShipping === 0 ? "Free" : money(displayShipping)}</span>
              </div>

              {/* GST Tax Breakdown (D1) */}
              <div className="rounded-md border border-border bg-muted/30 p-2.5 text-xs">
                <div className="flex items-center justify-between font-medium text-foreground">
                  <span>GST Tax</span>
                  <span>{money(displayTax)}</span>
                </div>
                {est?.tax ? (
                  <div className="mt-1 grid gap-0.5 text-muted-foreground">
                    {est.tax.isInterState ? (
                      <div className="flex justify-between">
                        <span>IGST</span>
                        <span>{money(est.tax.igst)}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span>CGST</span>
                          <span>{money(est.tax.cgst)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>SGST</span>
                          <span>{money(est.tax.sgst)}</span>
                        </div>
                      </>
                    )}
                  </div>
                ) : null}
              </div>

              {codFeePaise > 0 ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">COD Fee</span>
                  <span className="text-foreground">{money(codFeePaise)}</span>
                </div>
              ) : null}

              <div className="border-t border-border pt-2 flex items-center justify-between font-semibold text-base text-foreground">
                <span>Total</span>
                <span>{money(displayGrandTotal)}</span>
              </div>

              {create.isError ? <Alert variant="destructive">{errorMessage(create.error)}</Alert> : null}
              {hasLinePriceOverrideError ? (
                <p className="text-xs text-destructive">Every line price override requires a reason.</p>
              ) : null}
              {hasDiscountError ? (
                <p className="text-xs text-destructive">Manual discount requires a reason and amount.</p>
              ) : null}
              {hasShippingOverrideError ? (
                <p className="text-xs text-destructive">Shipping override requires a reason (max ₹10,000).</p>
              ) : null}

              <Button type="submit" size="lg" disabled={!ready || create.isPending} className="w-full">
                {create.isPending ? "Creating order..." : "Create order"}
              </Button>
              <Button type="button" variant="ghost" size="sm" nativeButton={false} render={<Link to="/orders" />}>
                Cancel
              </Button>
            </CardContent>
          </Card>
        </div>
      </form>

      {/* Inline Create Customer Dialog */}
      <CreateCustomerDialog
        open={showNewCustomerDialog}
        onOpenChange={setShowNewCustomerDialog}
        onCreated={(cust, addr) => {
          setSelectedCustomer(cust);
          setEmail(cust.email);
          if (cust.phone) setPhone(cust.phone);
          if (cust.name) setFullName(cust.name);
          if (addr) {
            setAddressLine1(addr.line1);
            if (addr.line2) setAddressLine2(addr.line2);
            setCity(addr.city);
            setState(addr.state);
            setPincode(addr.pincode);
          }
        }}
      />
    </PageContainer>
  );
}

/** Individual Line item row with quantity adjuster and price override */
function LineItemRow({
  line,
  onSetQty,
  onSetPriceOverride,
}: {
  line: Line;
  onSetQty: (qty: number) => void;
  onSetPriceOverride: (priceRupees: string, reason: string) => void;
}) {
  const [editingPrice, setEditingPrice] = useState(line.priceOverride != null);
  const [overrideInput, setOverrideInput] = useState(
    line.priceOverride != null ? (line.priceOverride / 100).toFixed(2) : "",
  );
  const [reasonInput, setReasonInput] = useState(line.priceOverrideReason ?? "");

  function handleSaveOverride() {
    onSetPriceOverride(overrideInput, reasonInput);
  }

  function handleResetPrice() {
    setOverrideInput("");
    setReasonInput("");
    setEditingPrice(false);
    onSetPriceOverride("", "");
  }

  const isOverridden = line.priceOverride != null;

  return (
    <div className="grid gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">{line.productTitle}</p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{line.variantTitle}</span>
            <span>·</span>
            <span className={isOverridden ? "line-through" : ""}>{money(line.originalPrice)}</span>
            {isOverridden ? (
              <Badge variant="outline" className="text-amber-600 dark:text-amber-400 font-mono text-[10px]">
                {money(line.effectivePrice)}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7"
            aria-label={`Decrease ${line.productTitle} quantity`}
            onClick={() => onSetQty(line.quantity - 1)}
          >
            <Minus className="size-3" />
          </Button>
          <span className="w-6 text-center tabular-nums text-sm font-medium" aria-live="polite">
            {line.quantity}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-7"
            aria-label={`Increase ${line.productTitle} quantity`}
            onClick={() => onSetQty(line.quantity + 1)}
          >
            <Plus className="size-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${line.productTitle}`}
            onClick={() => onSetQty(0)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => setEditingPrice((v) => !v)}
        >
          {editingPrice ? "Hide price override" : isOverridden ? "Edit price override" : "Override price"}
        </button>
        <span className="font-semibold text-foreground">
          {money(line.effectivePrice * line.quantity)}
        </span>
      </div>

      {editingPrice ? (
        <div className="mt-1 rounded border border-border bg-muted/30 p-2.5 grid gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`line-price-${line.variantId}`}>Custom unit price in ₹</FieldLabel>
              <Input
                id={`line-price-${line.variantId}`}
                type="number"
                min="0"
                value={overrideInput}
                onChange={(e) => setOverrideInput(e.target.value)}
                placeholder={(line.originalPrice / 100).toFixed(2)}
                className="h-8 text-xs"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`line-reason-${line.variantId}`}>Reason for override *</FieldLabel>
              <Input
                id={`line-reason-${line.variantId}`}
                value={reasonInput}
                onChange={(e) => setReasonInput(e.target.value)}
                placeholder="e.g. VIP pricing, damaged packaging"
                className="h-8 text-xs"
              />
            </Field>
          </div>
          <div className="flex items-center justify-end gap-2">
            {isOverridden ? (
              <Button type="button" variant="ghost" size="sm" onClick={handleResetPrice} className="h-7 text-xs">
                Reset to catalog price
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!overrideInput.trim() || !reasonInput.trim()}
              onClick={handleSaveOverride}
              className="h-7 text-xs"
            >
              Apply price
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
