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
  Skeleton,
} from "@bs/ui";

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
          <ThemeToggle />
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
          <h2 className="text-lg font-semibold tracking-tight">Buttons (6px radius, no pills)</h2>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <Button variant="primary">Primary Ink</Button>
            <Button variant="default">Default</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button size="sm">Small (32px)</Button>
            <Button disabled>Disabled</Button>
          </div>
        </section>

        {/* 4. Controls & Inputs */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Controls & Inputs</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
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
          </div>
        </section>

        {/* 5. Skeletons */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Skeletons (Pulse)</h2>
          <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        </section>
      </div>
    </div>
  );
}
