import { Button, Card, CardContent, CardHeader, CardTitle, Input, InfoTip, Label, SimpleSelect, Switch, Textarea } from "@bs/ui";
import { DEFAULT_PAGE_LABELS, DEFAULT_PAGES, ICON_NAMES, type DefaultPages } from "@bs/blocks";

type SectionKey = keyof DefaultPages;

interface FieldDef {
  key: string;
  label: string;
  kind: "text" | "textarea" | "switch" | "items";
  max?: number;
  hint?: string;
}

/** What each default page lets a theme change. Everything else on these pages stays fixed (ADR-032). */
const FIELDS: Record<SectionKey, FieldDef[]> = {
  checkout: [
    { key: "heading", label: "Heading", kind: "text", max: 60 },
    { key: "showTrustBadges", label: "Show trust line under the form", kind: "switch", hint: "Two short reassurance lines: secure checkout and review before paying." },
    { key: "note", label: "Note below the form (optional)", kind: "textarea", max: 200, hint: "Plain text, for example a delivery or support reminder. Leave empty to hide it." },
  ],
  orderSuccess: [
    { key: "heading", label: "Heading", kind: "text", max: 80 },
    { key: "message", label: "Message", kind: "textarea", max: 200, hint: "Use {email} where the shopper's email should appear." },
    { key: "showCreateAccount", label: "Offer to create an account", kind: "switch" },
    { key: "continueLabel", label: "Continue button label", kind: "text", max: 40 },
  ],
  paymentFailed: [
    { key: "heading", label: "Heading", kind: "text", max: 80 },
    { key: "declinedMessage", label: "When the bank declines", kind: "textarea", max: 200 },
    { key: "cancelledMessage", label: "When the shopper cancels", kind: "textarea", max: 200 },
    { key: "errorMessage", label: "Any other error", kind: "textarea", max: 200 },
    { key: "showSupportEmail", label: "Show the store's support email", kind: "switch" },
  ],
  search: [{ key: "emptyMessage", label: "No results message", kind: "textarea", max: 200 }],
  notFound: [
    { key: "heading", label: "Heading", kind: "text", max: 80 },
    { key: "message", label: "Message", kind: "textarea", max: 200 },
  ],
  miniCart: [
    { key: "heading", label: "Heading", kind: "text", max: 40 },
    { key: "showFreeShippingBar", label: "Free shipping progress bar", kind: "switch", hint: "Shows how far the cart is from the store's free-shipping amount (set in Shipping settings). Hidden when the store has none." },
    { key: "totalNote", label: "Small print under the total (optional)", kind: "text", max: 80 },
    { key: "checkoutLabel", label: "Checkout button label", kind: "text", max: 40 },
    { key: "continueLabel", label: "Continue shopping label", kind: "text", max: 40 },
    { key: "showTrustRow", label: "Reassurance row at the bottom", kind: "switch" },
    { key: "trustItems", label: "Reassurance items (up to 4)", kind: "items", max: 40, hint: "An icon and a few words each, for example 100% Secure Payments." },
  ],
};

const ORDER: SectionKey[] = ["checkout", "orderSuccess", "paymentFailed", "search", "notFound", "miniCart"];

const ICON_OPTIONS = ICON_NAMES.map((n) => ({ value: n, label: n.charAt(0).toUpperCase() + n.slice(1) }));
type TrustItem = { icon: (typeof ICON_NAMES)[number]; text: string };

/**
 * Wording and switches for the theme's default pages. A page left unchanged uses the built-in text, so the form always
 * shows the effective value. Values are plain text; the server rejects angle brackets when the draft is saved.
 */
export function DefaultPagesForm({
  value,
  onChange,
  onSave,
  onPublish,
  onExit,
  saving,
  status,
}: {
  value: DefaultPages;
  onChange: (next: DefaultPages) => void;
  onSave: () => void;
  onPublish: () => void;
  onExit: () => void;
  saving: boolean;
  status: string;
}) {
  const set = (section: SectionKey, key: string, v: string | boolean) => {
    onChange({ ...value, [section]: { ...value[section], [key]: v } } as DefaultPages);
  };
  const reset = (section: SectionKey) => onChange({ ...value, [section]: structuredClone(DEFAULT_PAGES[section]) } as DefaultPages);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <h1 className="text-base font-semibold">Default pages</h1>
          <p className="text-xs text-muted-foreground">{status}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onExit}>
            Back to editor
          </Button>
          <Button variant="outline" onClick={onSave} disabled={saving}>
            Save draft
          </Button>
          <Button onClick={onPublish} disabled={saving}>
            Publish
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto grid max-w-3xl gap-6">
          {ORDER.map((section) => (
            <Card key={section}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{DEFAULT_PAGE_LABELS[section]}</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => reset(section)}>
                  Reset to default
                </Button>
              </CardHeader>
              <CardContent className="grid gap-4">
                {FIELDS[section].map((f) => {
                  const id = `dp-${section}-${f.key}`;
                  const current = (value[section] as unknown as Record<string, string | boolean | TrustItem[]>)[f.key];
                  if (f.kind === "items") {
                    const items = (Array.isArray(current) ? current : []) as TrustItem[];
                    const setItems = (next: TrustItem[]) => set(section, f.key, next as unknown as string);
                    return (
                      <div key={f.key} className="grid gap-2">
                        <Label className="flex items-center gap-1.5">
                          {f.label}
                          {f.hint ? <InfoTip>{f.hint}</InfoTip> : null}
                        </Label>
                        {items.map((it, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <SimpleSelect ariaLabel={`Icon for item ${i + 1}`} className="w-32" value={it.icon} options={ICON_OPTIONS} onChange={(v) => setItems(items.map((x, j) => (j === i ? { ...x, icon: v as TrustItem["icon"] } : x)))} />
                            <Input aria-label={`Text for item ${i + 1}`} maxLength={f.max} value={it.text} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                            <Button variant="ghost" size="sm" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`}>
                              Remove
                            </Button>
                          </div>
                        ))}
                        {items.length < 4 ? (
                          <Button variant="outline" size="sm" className="w-fit" onClick={() => setItems([...items, { icon: "check", text: "New item" }])}>
                            Add item
                          </Button>
                        ) : null}
                      </div>
                    );
                  }
                  return (
                    <div key={f.key} className={f.kind === "switch" ? "flex items-center justify-between gap-3" : "grid gap-1.5"}>
                      <Label htmlFor={id} className="flex items-center gap-1.5">
                        {f.label}
                        {f.hint ? <InfoTip>{f.hint}</InfoTip> : null}
                      </Label>
                      {f.kind === "switch" ? (
                        <Switch id={id} checked={current === true} onCheckedChange={(c) => set(section, f.key, c)} />
                      ) : f.kind === "textarea" ? (
                        <Textarea id={id} rows={2} maxLength={f.max} value={String(current ?? "")} onChange={(e) => set(section, f.key, e.target.value)} />
                      ) : (
                        <Input id={id} maxLength={f.max} value={String(current ?? "")} onChange={(e) => set(section, f.key, e.target.value)} />
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
