import React, { useState } from "react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ThemeToggle,
  useTheme,
  Combobox,
  MultiSelect,
  CommandPalette,
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogClose,
  Spinner,
  Empty,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  StatusBadge,
  Money,
  RelativeTime,
  DatePicker,
  DateRangePicker,
  DateTimePicker,
  MetricCardsSkeleton,
  DataTableSkeleton,
} from "@bs/ui";
import { Search, Sparkles, Inbox, User, Settings } from "lucide-react";

const SAMPLE_NOW = 1775300000000;
const INITIAL_RANGE = {
  from: new Date(SAMPLE_NOW),
  to: new Date(SAMPLE_NOW + 86400000 * 7),
};
const SAMPLE_RELATIVE_DATE = new Date(SAMPLE_NOW - 3600000 * 4);

const TOKENS = [
  { name: "--background", desc: "Page and card surface" },
  { name: "--canvas", desc: "Canvas behind cards" },
  { name: "--card", desc: "Card and popover surface" },
  { name: "--muted", desc: "Muted fills and code bg" },
  { name: "--border", desc: "Hairline border" },
  { name: "--border-soft", desc: "Subtle divider" },
  { name: "--foreground", desc: "Primary text ink" },
  { name: "--foreground-2", desc: "Secondary body text" },
  { name: "--muted-foreground", desc: "Muted secondary text" },
  { name: "--brand", desc: "Brand mint accent (#00d4a4)" },
  { name: "--brand-deep", desc: "Brand pressed / dark ink" },
  { name: "--brand-ink", desc: "Brand text / link on light" },
  { name: "--brand-soft", desc: "Brand tint background" },
  { name: "--primary", desc: "Primary button fill (ink)" },
  { name: "--destructive", desc: "Error tone" },
  { name: "--warning", desc: "Warning tone" },
  { name: "--success", desc: "Success tone" },
  { name: "--info", desc: "Info tone" },
];

export function Kit() {
  const { preference, resolved } = useTheme();
  const [inputValue, setInputValue] = useState("");
  const [comboboxVal, setComboboxVal] = useState("in");
  const [multiVal, setMultiVal] = useState<string[]>(["electronics", "apparel"]);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [otpVal, setOtpVal] = useState("123456");
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [dateTime, setDateTime] = useState<Date | undefined>(new Date());
  const [range, setRange] = useState<{ from?: Date; to?: Date } | undefined>(INITIAL_RANGE);

  return (
    <div className="min-h-screen bg-[var(--background)] p-8 text-[var(--foreground)] font-sans antialiased">
      <div className="mx-auto max-w-5xl space-y-12">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between border-b border-[var(--border)] pb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Design System Kit</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Dev-only component and token reference · Current preference:{" "}
              <strong className="text-[var(--foreground)]">{preference}</strong> (resolved:{" "}
              <strong className="text-[var(--foreground)]">{resolved}</strong>)
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setCmdOpen(true)}>
              <Search className="size-3.5 mr-1.5" />
              Command Palette (Ctrl+K)
            </Button>
            <ThemeToggle />
          </div>
        </div>

        {/* 1. Color Tokens */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Semantic Color Tokens</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {TOKENS.map((token) => (
              <div
                key={token.name}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 shadow-xs"
              >
                <div
                  className="h-12 w-full rounded border border-[var(--border-soft)] mb-2"
                  style={{ backgroundColor: `var(${token.name})` }}
                />
                <div className="font-mono text-xs font-semibold">{token.name}</div>
                <div className="text-[11px] text-[var(--muted-foreground)] truncate">{token.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 2. Typography Scale */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Typography Scale (Geist & Geist Mono)</h2>
          <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="flex items-baseline justify-between border-b border-[var(--border-soft)] pb-2">
              <span className="text-[20px] font-semibold leading-[1.3]">Page Title (20px / 600)</span>
              <span className="font-mono text-xs text-[var(--muted-foreground)]">text-[20px] font-semibold</span>
            </div>
            <div className="flex items-baseline justify-between border-b border-[var(--border-soft)] pb-2">
              <span className="text-[14px] font-semibold">Section Title (14px / 600)</span>
              <span className="font-mono text-xs text-[var(--muted-foreground)]">text-[14px] font-semibold</span>
            </div>
            <div className="flex items-baseline justify-between border-b border-[var(--border-soft)] pb-2">
              <span className="text-[13px] font-normal leading-[1.5]">Body & Form Text (13px / 400 / 1.5)</span>
              <span className="font-mono text-xs text-[var(--muted-foreground)]">text-[13px] font-normal</span>
            </div>
            <div className="flex items-baseline justify-between border-b border-[var(--border-soft)] pb-2">
              <span className="text-[12px] font-normal leading-[1.4] text-[var(--muted-foreground)]">
                Dense Table & Meta Text (12px / 400)
              </span>
              <span className="font-mono text-xs text-[var(--muted-foreground)]">text-[12px]</span>
            </div>
            <div className="flex items-baseline justify-between border-b border-[var(--border-soft)] pb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                MICRO LABEL (11px / 600 uppercase)
              </span>
              <span className="font-mono text-xs text-[var(--muted-foreground)]">text-[11px] uppercase</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[13px] tabular-nums">Geist Mono: ORD-9284-X · ₹12,450.00 (tabular-nums)</span>
              <span className="font-mono text-xs text-[var(--muted-foreground)]">font-mono tabular-nums</span>
            </div>
          </div>
        </section>

        {/* 3. Button Matrix */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Buttons (6px radius, no pills, loading state)</h2>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <Button variant="primary">Primary Ink</Button>
            <Button variant="brand">Brand Mint</Button>
            <Button variant="default">Default</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button size="sm">Small (32px)</Button>
            <Button size="icon"><Sparkles className="size-4" /></Button>
            <Button disabled>Disabled</Button>
            <Button loading>Loading...</Button>
          </div>
        </section>

        {/* 4. Controls, Inputs & Select Family */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Select Family & Input Primitives</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Text Input</label>
              <Input
                placeholder="Enter value..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Select</label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Choose option..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opt1">Option 1</SelectItem>
                  <SelectItem value="opt2">Option 2</SelectItem>
                  <SelectItem value="opt3">Option 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Combobox (Searchable)</label>
              <Combobox
                value={comboboxVal}
                onChange={setComboboxVal}
                placeholder="Select country..."
                options={[
                  { value: "in", label: "India (+91)" },
                  { value: "us", label: "United States (+1)" },
                  { value: "ae", label: "United Arab Emirates (+971)" },
                  { value: "gb", label: "United Kingdom (+44)" },
                ]}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-medium">MultiSelect (Chips)</label>
              <MultiSelect
                value={multiVal}
                onChange={setMultiVal}
                placeholder="Select tags..."
                options={[
                  { value: "electronics", label: "Electronics" },
                  { value: "apparel", label: "Apparel" },
                  { value: "groceries", label: "Groceries" },
                  { value: "footwear", label: "Footwear" },
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Input OTP (6 Digits)</label>
              <InputOTP maxLength={6} value={otpVal} onChange={setOtpVal}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
          </div>
        </section>

        {/* 5. Date & Time Pickers */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Date & Time Family</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Date Picker</label>
              <DatePicker value={date} onChange={setDate} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Date Range Picker</label>
              <DateRangePicker
                from={range?.from ? range.from.toISOString().slice(0, 10) : undefined}
                to={range?.to ? range.to.toISOString().slice(0, 10) : undefined}
                onChange={(f, t) => {
                  const next: { from?: Date; to?: Date } = {};
                  if (f) next.from = new Date(f);
                  if (t) next.to = new Date(t);
                  setRange(next);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Date Time Picker</label>
              <DateTimePicker value={dateTime} onChange={setDateTime} />
            </div>
          </div>
        </section>

        {/* 6. Overlays & Responsive Dialog */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Responsive Dialog (Dialog on Desktop, Drawer on Mobile)</h2>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <ResponsiveDialog>
              <ResponsiveDialogTrigger render={<Button variant="outline">Open Responsive Dialog</Button>} />
              <ResponsiveDialogContent>
                <ResponsiveDialogHeader>
                  <ResponsiveDialogTitle>Responsive Dialog Example</ResponsiveDialogTitle>
                  <ResponsiveDialogDescription>
                    On desktop (viewport &gt; 768px), this renders as an accessible modal Dialog. On mobile viewports, it opens as a smooth bottom Drawer.
                  </ResponsiveDialogDescription>
                </ResponsiveDialogHeader>
                <div className="py-4 text-xs text-[var(--muted-foreground)]">
                  Fully keyboard accessible with focus restoration and Esc to close.
                </div>
                <ResponsiveDialogFooter>
                  <ResponsiveDialogClose render={<Button variant="outline">Cancel</Button>} />
                  <Button variant="primary">Confirm</Button>
                </ResponsiveDialogFooter>
              </ResponsiveDialogContent>
            </ResponsiveDialog>
          </div>
        </section>

        {/* 7. Status & Money Parts */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Status Badges, Money & Relative Time</h2>
          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="flex items-center gap-2">
              <StatusBadge tone="success" label="Active" withDot />
              <StatusBadge tone="warning" label="Pending" withDot />
              <StatusBadge tone="destructive" label="Failed" withDot />
              <StatusBadge tone="neutral" label="Draft" withDot />
              <StatusBadge tone="brand" label="Featured" withDot />
            </div>
            <div className="border-l border-[var(--border)] pl-6 flex items-center gap-4">
              <Money amountInPaise={149900} />
              <Money amountInPaise={25000000} className="text-base font-semibold" />
            </div>
            <div className="border-l border-[var(--border)] pl-6">
              <RelativeTime date={SAMPLE_RELATIVE_DATE} />
            </div>
          </div>
        </section>

        {/* 8. Spinner & Empty States */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Spinners & Empty States</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <div className="flex items-center justify-center gap-4 p-8 border border-dashed border-[var(--border)] rounded-md">
              <Spinner size="sm" />
              <Spinner size="md" />
              <Spinner size="lg" />
            </div>
            <Empty
              icon={Inbox}
              title="No items found"
              description="Get started by creating your first product or adjusting your filters."
              action={<Button size="sm">Create Product</Button>}
            />
          </div>
        </section>

        {/* 9. Composed Skeletons */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Composed Skeletons (CLS 0)</h2>
          <div className="space-y-6">
            <MetricCardsSkeleton count={4} />
            <DataTableSkeleton rows={4} columns={4} />
          </div>
        </section>

        {/* Command Palette Component */}
        <CommandPalette
          open={cmdOpen}
          onOpenChange={setCmdOpen}
          actions={[
            { id: "1", label: "Go to Overview", group: "Navigation", icon: Sparkles, onSelect: () => setCmdOpen(false) },
            { id: "2", label: "Tenants List", group: "Navigation", icon: User, onSelect: () => setCmdOpen(false) },
            { id: "3", label: "Settings", group: "Navigation", icon: Settings, onSelect: () => setCmdOpen(false) },
          ]}
        />
      </div>
    </div>
  );
}
