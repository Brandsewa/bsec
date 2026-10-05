import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Ban, MapPin, MoreHorizontal, Pencil, Plus, ShieldCheck, Tag, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, PageBreadcrumbs, PageContainer, PageSkeleton, toast } from "@bs/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UsersRound } from "lucide-react";
import { Badge } from "@bs/ui";
import { Button } from "@bs/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@bs/ui";
import { Checkbox } from "@bs/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@bs/ui";
import { Input } from "@bs/ui";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { Field } from "../../components/field.tsx";
import { SectionCard } from "../../components/section-card.tsx";
import { SimpleSelect } from "../../components/simple-select.tsx";
import { useUnsavedGuard } from "../../components/settings/settings-page.tsx";
import { StatusBadge, money } from "../../components/order-parts.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { client, orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/customers_/$customerId")({
  pendingComponent: () => <PageSkeleton />,
  component: CustomerDetailPage,
});

const MARKETING_LABEL: Record<string, string> = {
  subscribed: "Subscribed",
  unsubscribed: "Unsubscribed",
  not_subscribed: "Not subscribed",
  invalid: "Invalid",
};

const ORDER_STATUS_OPTIONS = [
  ["any", "All statuses"],
  ["pending", "Pending"],
  ["confirmed", "Confirmed"],
  ["processing", "Processing"],
  ["partially_fulfilled", "Partially fulfilled"],
  ["fulfilled", "Fulfilled"],
  ["delivered", "Delivered"],
  ["cancelled", "Cancelled"],
  ["returned", "Returned"],
] as const;

function fmtDay(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}

type Detail = Awaited<ReturnType<typeof client.admin.customers.get>>;

// ---------------------------------------------------------------------------------------------------------------
// Profile card: editable for guests and unverified accounts; verified accounts can only fix
// name and phone here. Saving goes through customers.update, which audits and clears
// email verification when the email changes.
// ---------------------------------------------------------------------------------------------------------------

function ProfileCard({ detail }: { detail: Detail }) {
  const qc = useQueryClient();
  const c = detail.customer;
  const [name, setName] = useState(c.name);
  const [phone, setPhone] = useState(c.phone ?? "");
  const [email, setEmail] = useState(c.email);
  const dirty = name !== c.name || phone !== (c.phone ?? "") || email !== c.email;
  useUnsavedGuard(dirty);

  const emailLocked = c.emailVerified && !c.isGuest;

  const save = async () => {
    try {
      await client.admin.customers.update({
        id: c.id,
        ...(name !== c.name ? { name } : {}),
        ...(phone !== (c.phone ?? "") ? { phone: phone.trim() || null } : {}),
        ...(email !== c.email && !emailLocked ? { email } : {}),
      });
      toast.success("Customer saved.");
      void qc.invalidateQueries({ queryKey: orpc.admin.customers.key() });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <SectionCard title="Profile" {...(emailLocked ? { description: "This account's email is verified; the customer changes it from their account page." } : {})}>
      <div className="grid gap-3 md:grid-cols-3">
        <Field id="cust-name" label="Name">
          <Input id="cust-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
        </Field>
        <Field id="cust-email" label={emailLocked ? "Email (verified)" : "Email"}>
          <Input id="cust-email" type="email" value={email} disabled={emailLocked} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field id="cust-phone" label="Phone">
          <Input id="cust-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={!dirty} onClick={() => void save()}>
          Save changes
        </Button>
        {c.isGuest ? <Badge variant="outline">Guest</Badge> : null}
        {c.emailVerified ? <Badge variant="secondary">Email verified</Badge> : <Badge variant="outline">Email not verified</Badge>}
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Addresses card: staff CRUD with a dialog form, default flag and delete confirm.
// ---------------------------------------------------------------------------------------------------------------

type AddressType = "home" | "work" | "other";
type AddressForm = { name: string; phone: string; line1: string; line2: string; city: string; stateCode: string; pincode: string; type: AddressType; isDefault: boolean };
const emptyAddress: AddressForm = { name: "", phone: "", line1: "", line2: "", city: "", stateCode: "KA", pincode: "", type: "home", isDefault: false };

function AddressesCard({ detail }: { detail: Detail }) {
  const qc = useQueryClient();
  const customerId = detail.customer.id;
  const [editing, setEditing] = useState<{ id: string | null; form: AddressForm } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: orpc.admin.customers.key() });

  const save = async () => {
    if (!editing) return;
    const f = editing.form;
    try {
      const address = { name: f.name, phone: f.phone, line1: f.line1, city: f.city, stateCode: f.stateCode, pincode: f.pincode, type: f.type, isDefault: f.isDefault, ...(f.line2.trim() ? { line2: f.line2.trim() } : {}) };
      if (editing.id) {
        await client.admin.customers.addresses.update({ id: customerId, addressId: editing.id, address });
        toast.success("Address updated.");
      } else {
        await client.admin.customers.addresses.add({ id: customerId, address });
        toast.success("Address added.");
      }
      setEditing(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          Addresses
          <Button variant="outline" size="sm" onClick={() => setEditing({ id: null, form: emptyAddress })}>
            <Plus className="mr-1 size-3.5" aria-hidden /> Add address
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {detail.addresses.length === 0 ? (
          <p className="text-muted-foreground">No saved addresses.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {detail.addresses.map((a) => (
              <div key={a.id} className="rounded-md border border-border p-3">
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <MapPin className="size-3.5 text-muted-foreground" aria-hidden />
                  {a.name}
                  {a.isDefault ? <Badge variant="secondary" className="ml-auto">Default</Badge> : <Badge variant="outline" className="ml-auto capitalize">{a.type}</Badge>}
                </p>
                <address className="mt-1 text-muted-foreground not-italic">
                  <div>{a.line1}</div>
                  {a.line2 ? <div>{a.line2}</div> : null}
                  <div>
                    {a.city}, {a.stateCode} {a.pincode}
                  </div>
                  <div>{a.phone}</div>
                </address>
                <div className="mt-2 flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setEditing({ id: a.id, form: { name: a.name, phone: a.phone, line1: a.line1, line2: a.line2 ?? "", city: a.city, stateCode: a.stateCode, pincode: a.pincode, type: a.type as AddressType, isDefault: a.isDefault } })
                    }
                  >
                    <Pencil className="mr-1 size-3" aria-hidden /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(a.id)}>
                    <Trash2 className="mr-1 size-3" aria-hidden /> Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing?.id ? "Edit address" : "Add address"}</DialogTitle>
            </DialogHeader>
            {editing ? (
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="addr-name" label="Name">
                    <Input id="addr-name" value={editing.form.name} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} />
                  </Field>
                  <Field id="addr-phone" label="Phone">
                    <Input id="addr-phone" value={editing.form.phone} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, phone: e.target.value } })} />
                  </Field>
                </div>
                <Field id="addr-line1" label="Address line 1">
                  <Input id="addr-line1" value={editing.form.line1} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, line1: e.target.value } })} />
                </Field>
                <Field id="addr-line2" label="Address line 2 (optional)">
                  <Input id="addr-line2" value={editing.form.line2} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, line2: e.target.value } })} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field id="addr-city" label="City">
                    <Input id="addr-city" value={editing.form.city} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, city: e.target.value } })} />
                  </Field>
                  <Field id="addr-state" label="State">
                    <Input id="addr-state" value={editing.form.stateCode} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, stateCode: e.target.value.toUpperCase() } })} />
                  </Field>
                  <Field id="addr-pin" label="PIN code">
                    <Input id="addr-pin" value={editing.form.pincode} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, pincode: e.target.value } })} />
                  </Field>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={editing.form.isDefault} onCheckedChange={(v) => setEditing({ ...editing, form: { ...editing.form, isDefault: v === true } })} />
                    Set as default address
                  </label>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void save()}>
                      {editing.id ? "Save address" : "Add address"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(open) => !open && setRemoving(null)}
          title="Delete this address?"
          description="The address is removed from the customer's address book. Orders already placed keep their shipping snapshot."
          confirmLabel="Delete address"
          destructive
          onConfirm={() => {
            const id = removing;
            setRemoving(null);
            if (id) {
              void client.admin.customers.addresses
                .delete({ id: customerId, addressId: id })
                .then(() => {
                  toast.success("Address deleted.");
                  refresh();
                })
                .catch((e: unknown) => toast.error(errorMessage(e)));
            }
          }}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Orders card: full history with a status filter, linking to each order.
// ---------------------------------------------------------------------------------------------------------------

function OrdersCard({ customerId }: { customerId: string }) {
  const [status, setStatus] = useState("any");
  const orders = useQuery(orpc.admin.customers.orders.queryOptions({ input: { id: customerId, ...(status !== "any" ? { status } : {}) } }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          Orders
          <SimpleSelect
            ariaLabel="Filter orders by status"
            className="w-full sm:w-48"
            value={status}
            options={ORDER_STATUS_OPTIONS.map(([value, label]) => ({ value, label }))}
            onChange={setStatus}
          />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {orders.isLoading ? (
          <p className="text-muted-foreground">Loading orders…</p>
        ) : orders.isError ? (
          <p className="text-destructive">{errorMessage(orders.error)}</p>
        ) : (orders.data?.items.length ?? 0) === 0 ? (
          <p className="text-muted-foreground">No orders{status !== "any" ? " with this status" : " yet"}.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {(orders.data?.items ?? []).map((o) => (
              <Link key={o.id} to="/orders/$orderId" params={{ orderId: o.id }} className="flex items-center justify-between gap-4 p-3 hover:bg-muted">
                <div>
                  <p className="font-medium text-foreground">{o.number}</p>
                  <p className="text-muted-foreground">{fmtDay(o.placedAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={o.paymentStatus} />
                  <span className="hidden font-medium text-foreground sm:inline">{money(o.grandTotal)}</span>
                  <MoreHorizontal className="text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Activity timeline from existing tables.
// ---------------------------------------------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  order: "Order",
  return: "Return",
  quote: "Quote",
  review: "Review",
  abandoned_cart: "Checkout",
  consent: "Marketing",
};

function ActivityCard({ customerId }: { customerId: string }) {
  const activity = useQuery(orpc.admin.customers.activity.queryOptions({ input: { id: customerId } }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {activity.isLoading ? (
          <p className="text-muted-foreground">Loading activity…</p>
        ) : (activity.data?.items.length ?? 0) === 0 ? (
          <p className="text-muted-foreground">Nothing yet.</p>
        ) : (
          <ol className="relative grid gap-3 border-l border-border pl-4">
            {(activity.data?.items ?? []).map((item, i) => (
              <li key={`${item.kind}-${item.ref ?? i}`} className="relative">
                <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-muted-foreground/40" aria-hidden />
                <p className="text-sm font-medium text-foreground">{item.title}</p>
                <p className="text-xs text-muted-foreground">
                  {KIND_LABEL[item.kind] ?? item.kind}
                  {item.detail ? ` · ${item.detail}` : ""} · {new Date(item.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Right rail: status, marketing consent, tags, notes.
// ---------------------------------------------------------------------------------------------------------------

function StatusCard({ detail }: { detail: Detail }) {
  const qc = useQueryClient();
  const c = detail.customer;
  const [ask, setAsk] = useState<"active" | "blocked" | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: orpc.admin.customers.key() });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          Status
          {c.status === "blocked" ? <Badge variant="destructive">Blocked</Badge> : <Badge variant="default">Active</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          {c.status === "blocked"
            ? "Blocked customers cannot sign in or place orders. Their past orders are kept."
            : "The customer can sign in and place orders."}
        </p>
        {c.status === "blocked" ? (
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setAsk("active")}>
            <ShieldCheck className="mr-1.5 size-3.5" aria-hidden /> Unblock customer
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setAsk("blocked")}>
            <Ban className="mr-1.5 size-3.5" aria-hidden /> Block customer
          </Button>
        )}
        <ConfirmDialog
          open={ask !== null}
          onOpenChange={(open) => !open && setAsk(null)}
          title={ask === "blocked" ? `Block ${c.name || c.email}?` : `Unblock ${c.name || c.email}?`}
          description={
            ask === "blocked"
              ? "They cannot sign in or check out while blocked. Their orders and history are kept, and you can unblock them at any time."
              : "They can sign in and place orders again."
          }
          confirmLabel={ask === "blocked" ? "Block customer" : "Unblock customer"}
          destructive={ask === "blocked"}
          onConfirm={() => {
            const to = ask;
            setAsk(null);
            if (to) {
              void client.admin.customers.setStatus({ id: c.id, status: to }).then(() => {
                toast.success(to === "blocked" ? "Customer blocked." : "Customer unblocked.");
                refresh();
              });
            }
          }}
        />
      </CardContent>
    </Card>
  );
}

function MarketingCard({ detail }: { detail: Detail }) {
  const qc = useQueryClient();
  const c = detail.customer;
  const [ask, setAsk] = useState<"subscribed" | "unsubscribed" | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: orpc.admin.customers.key() });
  const subscribed = c.marketingState === "subscribed";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          Marketing
          <Badge variant={subscribed ? "default" : "outline"}>{MARKETING_LABEL[c.marketingState] ?? c.marketingState}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          {c.marketingSource ? `Source: ${c.marketingSource.replace("_", " ")} · ` : ""}
          {c.marketingUpdatedAt ? `updated ${fmtDay(c.marketingUpdatedAt)}` : "never updated"}
        </p>
        <Button variant="outline" size="sm" className="mt-3 w-full" disabled={ask !== null} onClick={() => setAsk(subscribed ? "unsubscribed" : "subscribed")}>
          {subscribed ? "Unsubscribe from marketing" : "Subscribe to marketing"}
        </Button>
        {detail.consentHistory.length > 0 ? (
          <div className="mt-3 grid gap-1.5 border-t border-border pt-3">
            <p className="text-xs font-medium text-foreground">Consent history</p>
            {detail.consentHistory.map((e) => (
              <p key={e.id} className="text-xs text-muted-foreground">
                {MARKETING_LABEL[e.state] ?? e.state} · {e.source.replace("_", " ")} · {fmtDay(e.at)}
              </p>
            ))}
          </div>
        ) : null}
        <ConfirmDialog
          open={ask !== null}
          onOpenChange={(open) => !open && setAsk(null)}
          title={ask === "subscribed" ? `Subscribe ${c.name || c.email} to marketing?` : `Unsubscribe ${c.name || c.email} from marketing?`}
          description={
            ask === "subscribed"
              ? "Record that this customer agreed to receive marketing email. The change is written to their consent history."
              : "They stop receiving marketing email. The change is written to their consent history."
          }
          confirmLabel={ask === "subscribed" ? "Subscribe" : "Unsubscribe"}
          onConfirm={() => {
            const to = ask;
            setAsk(null);
            if (to) {
              void client.admin.customers.consentSet({ id: c.id, state: to }).then(() => {
                toast.success(to === "subscribed" ? "Subscribed." : "Unsubscribed.");
                refresh();
              });
            }
          }}
        />
      </CardContent>
    </Card>
  );
}

function TagsCard({ detail }: { detail: Detail }) {
  const qc = useQueryClient();
  const c = detail.customer;
  const options = useQuery(orpc.admin.customers.tags.queryOptions());
  const [tag, setTag] = useState("");
  const suggestions = useMemo(() => (options.data?.tags ?? []).filter((t) => !c.tags.includes(t)).slice(0, 20), [options.data, c.tags]);

  const setTags = (tags: string[]) => {
    void client.admin.customers
      .setTags({ id: c.id, tags })
      .then(() => void qc.invalidateQueries({ queryKey: orpc.admin.customers.key() }))
      .catch((e: unknown) => toast.error(errorMessage(e)));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tags</CardTitle>
      </CardHeader>
      <CardContent>
        {c.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {c.tags.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
                <button
                  type="button"
                  aria-label={`Remove tag ${t}`}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setTags(c.tags.filter((x) => x !== t))}
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No tags yet.</p>
        )}
        <div className="mt-3 flex gap-2">
          <Input aria-label="New tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Add a tag…" />
          <Button
            variant="outline"
            size="sm"
            disabled={!tag.trim()}
            onClick={() => {
              setTags([...c.tags, tag.trim()]);
              setTag("");
            }}
          >
            <Tag className="mr-1 size-3.5" aria-hidden /> Add
          </Button>
        </div>
        {suggestions.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {suggestions.slice(0, 6).map((t) => (
              <Button key={t} variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => setTags([...c.tags, t])}>
                <Plus className="mr-0.5 size-3" aria-hidden /> {t}
              </Button>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NotesCard({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const notes = useQuery(orpc.admin.customers.notes.list.queryOptions({ input: { id: customerId } }));
  const [body, setBody] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: orpc.admin.customers.notes.key() });

  const add = async () => {
    try {
      await client.admin.customers.notes.add({ id: customerId, body });
      setBody("");
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Input aria-label="New note" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add an internal note…" maxLength={1000} />
          <Button size="sm" disabled={!body.trim()} onClick={() => void add()}>
            Add
          </Button>
        </div>
        {notes.isLoading ? (
          <p className="mt-3 text-muted-foreground">Loading notes…</p>
        ) : (notes.data?.items.length ?? 0) === 0 ? (
          <p className="mt-3 text-muted-foreground">No notes yet.</p>
        ) : (
          <ol className="mt-3 grid gap-3">
            {(notes.data?.items ?? []).map((n) => (
              <li key={n.id} className="rounded-md border border-border p-3">
                <p className="text-sm text-foreground">{n.body}</p>
                <p className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {n.authorName ?? "Imported"} · {fmtDay(n.createdAt)}
                  </span>
                  <Button variant="ghost" size="sm" className="h-6 px-1.5" aria-label="Delete note" onClick={() => setRemoving(n.id)}>
                    <Trash2 className="size-3" aria-hidden />
                  </Button>
                </p>
              </li>
            ))}
          </ol>
        )}
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(open) => !open && setRemoving(null)}
          title="Delete this note?"
          description="The note is removed for every staff member. The deletion is audited."
          confirmLabel="Delete note"
          destructive
          onConfirm={() => {
            const id = removing;
            setRemoving(null);
            if (id) {
              void client.admin.customers.notes
                .delete({ noteId: id })
                .then(() => {
                  toast.success("Note deleted.");
                  refresh();
                })
                .catch((e: unknown) => toast.error(errorMessage(e)));
            }
          }}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Segments card (Customers Phase 2 integration): manual memberships with remove, automatic
// matches as read-only chips linking to the segment.
// ---------------------------------------------------------------------------------------------------------------

function SegmentsCard({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const segments = useQuery(orpc.admin.segments.forCustomer.queryOptions({ input: { customerId } }));
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.admin.segments.key() });

  const remove = () => {
    const target = removing;
    setRemoving(null);
    if (target) {
      void client.admin.segments.members
        .remove({ id: target.id, customerIds: [customerId] })
        .then(() => {
          toast.success(`Removed from "${target.name}".`);
          refresh();
        })
        .catch((e: unknown) => toast.error(errorMessage(e)));
    }
  };

  const manual = segments.data?.manual ?? [];
  const automatic = segments.data?.automatic ?? [];
  const empty = manual.length === 0 && automatic.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <UsersRound className="size-4 text-muted-foreground" aria-hidden /> Segments
        </CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="text-muted-foreground">Not in any segment.</p>
        ) : (
          <div className="grid gap-2">
            {manual.map((seg) => (
              <div key={seg.id} className="flex items-center justify-between gap-2">
                <Badge variant="secondary">{seg.name}</Badge>
                <Button variant="ghost" size="sm" className="h-6 px-1.5" aria-label={`Remove from ${seg.name}`} onClick={() => setRemoving(seg)}>
                  <X className="size-3" aria-hidden />
                </Button>
              </div>
            ))}
            {automatic.map((seg) => (
              <div key={seg.id}>
                <Badge variant="outline" render={<Link to="/segments/$segmentId" params={{ segmentId: seg.id }} />}>
                  {seg.name}
                </Badge>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Automatic segments are read-only: membership comes from their conditions.</p>
          </div>
        )}
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(open) => !open && setRemoving(null)}
          title={removing ? `Remove this customer from "${removing.name}"?` : ""}
          description="They keep all their data; they are just no longer in this segment."
          confirmLabel="Remove"
          destructive
          onConfirm={remove}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------------------------

export function CustomerDetailPage(props: { customerId?: string } = {}) {
  // Route.useParams must run on every render (rules of hooks); the prop overrides it for tests.
  const params = Route.useParams();
  const customerId = props.customerId ?? params.customerId;
  const detail = useQuery(orpc.admin.customers.get.queryOptions({ input: { id: customerId } }));

  if (detail.isLoading) {
    return (
      <PageContainer>
        <PageSkeleton />
      </PageContainer>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <PageContainer size="small">
        <PageBreadcrumbs items={[{ label: "Customers", href: "/customers" }, { label: "Customer" }]} />
        <EmptyState
          title="Could not load this customer"
          description={detail.error ? errorMessage(detail.error) : "They may have been removed."}
          action={<Button onClick={() => void detail.refetch()}>Try again</Button>}
        />
      </PageContainer>
    );
  }

  const c = detail.data.customer;
  const name = c.name || "Unnamed customer";

  return (
    <PageContainer size="full">
      <PageBreadcrumbs items={[{ label: "Customers", href: "/customers" }, { label: name }]} />
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3">
        <Button variant="ghost" size="icon" aria-label="Back to customers" render={<Link to="/customers" />}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-lg font-semibold text-foreground">
            {name}
            {c.isGuest ? <Badge variant="outline">Guest</Badge> : null}
            {c.status === "blocked" ? <Badge variant="destructive">Blocked</Badge> : null}
          </h1>
          <p className="truncate text-xs text-muted-foreground">{c.email}</p>
        </div>
        <Button variant="outline" size="sm" render={<Link to="/orders/new" />}>
          Create order
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Orders" value={String(c.ordersCount)} />
        <Tile label="Lifetime value" value={money(c.totalSpent)} />
        <Tile label="Average order value" value={money(c.averageOrderValue)} />
        <Tile label="Last order" value={fmtDay(c.lastOrderAt)} />
        <Tile label="Customer since" value={fmtDay(c.createdAt)} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-4">
          <ProfileCard detail={detail.data} />
          <AddressesCard detail={detail.data} />
          <OrdersCard customerId={c.id} />
          <ActivityCard customerId={c.id} />
        </div>
        <div className="grid gap-4">
          <StatusCard detail={detail.data} />
          <MarketingCard detail={detail.data} />
          <TagsCard detail={detail.data} />
          <SegmentsCard customerId={c.id} />
          <NotesCard customerId={c.id} />
        </div>
      </div>
    </PageContainer>
  );
}
