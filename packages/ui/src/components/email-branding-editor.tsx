import * as React from "react";
import { Monitor, Plus, Smartphone, Trash2 } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { SectionCard } from "./section-card";
import { SimpleSelect } from "./simple-select";

/**
 * The email branding editor shared by Super Admin (platform layer: colours, fonts, sizes, footer) and the store admin
 * (store layer: logo, colours, footer; fonts are the platform's). docs/NOTIFICATION-MANAGER-PLAN.md section 6c.
 * Presentation only: the parent owns the value, the preview request and the save.
 */

export interface EmailBrandingValue {
  logoUrl: string | null;
  background: string;
  card: string;
  headerBackground: string;
  headerText: string;
  text: string;
  mutedText: string;
  accent: string;
  buttonBackground: string;
  buttonText: string;
  linkColor: string;
  fontFamily: string;
  baseFontSize: number;
  headingScale: number;
  footer: { text: string; address: string; supportEmail: string; links: Array<{ label: string; url: string }> };
}

export interface EmailBrandingIssue {
  field: string;
  message: string;
}

export interface EmailBrandingEditorProps {
  value: EmailBrandingValue;
  onChange: (next: EmailBrandingValue) => void;
  /** Preview HTML for the current value (the parent debounces and fetches it). */
  previewHtml: string;
  issues: EmailBrandingIssue[];
  /** The platform layer edits fonts and sizes; a store does not. */
  showTypography: boolean;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  /** Short line under the title, e.g. who sees these emails. */
  audienceNote: string;
}

const FONT_OPTIONS = [
  { value: "system", label: "System sans-serif" },
  { value: "georgia", label: "Georgia (serif)" },
  { value: "trebuchet", label: "Trebuchet" },
  { value: "verdana", label: "Verdana" },
  { value: "tahoma", label: "Tahoma" },
  { value: "times", label: "Times (serif)" },
];

function ColourField({ id, label, hint, value, onChange, issue }: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; issue?: string | undefined }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
        />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" maxLength={7} />
      </div>
      {hint && !issue ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {issue ? <p className="text-xs text-destructive">{issue}</p> : null}
    </div>
  );
}

export function EmailBrandingEditor({ value, onChange, previewHtml, issues, showTypography, onSave, saving, dirty, audienceNote }: EmailBrandingEditorProps) {
  const [device, setDevice] = React.useState<"desktop" | "mobile">("desktop");
  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message;
  const set = <K extends keyof EmailBrandingValue>(key: K, v: EmailBrandingValue[K]) => onChange({ ...value, [key]: v });
  const setFooter = (patch: Partial<EmailBrandingValue["footer"]>) => onChange({ ...value, footer: { ...value.footer, ...patch } });
  const links = value.footer.links;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <p className="text-sm text-muted-foreground">{audienceNote}</p>

        <SectionCard title="Logo" description="Shown in the email header. Without one, the name is shown as text.">
          <div className="grid gap-1.5">
            <Label htmlFor="eb-logo">Logo image address (https)</Label>
            <Input id="eb-logo" placeholder="https://…/logo.png" value={value.logoUrl ?? ""} onChange={(e) => set("logoUrl", e.target.value.trim() === "" ? null : e.target.value)} />
            {issueFor("logoUrl") ? <p className="text-xs text-destructive">{issueFor("logoUrl")}</p> : <p className="text-xs text-muted-foreground">A wide PNG or JPG about 44 px tall works best.</p>}
          </div>
        </SectionCard>

        <SectionCard title="Colours" description="Buttons and links follow the accent unless you set them.">
          <div className="grid gap-3 sm:grid-cols-2">
            <ColourField id="eb-accent" label="Accent" hint="Top bar and highlights." value={value.accent} onChange={(v) => set("accent", v)} issue={issueFor("accent")} />
            <ColourField id="eb-btn" label="Button" value={value.buttonBackground} onChange={(v) => set("buttonBackground", v)} issue={issueFor("buttonBackground")} />
            <ColourField id="eb-btn-text" label="Button text" value={value.buttonText} onChange={(v) => set("buttonText", v)} issue={issueFor("buttonText")} />
            <ColourField id="eb-link" label="Links" value={value.linkColor} onChange={(v) => set("linkColor", v)} issue={issueFor("linkColor")} />
            <ColourField id="eb-header-bg" label="Header background" value={value.headerBackground} onChange={(v) => set("headerBackground", v)} issue={issueFor("headerBackground")} />
            <ColourField id="eb-header-text" label="Header text" value={value.headerText} onChange={(v) => set("headerText", v)} issue={issueFor("headerText")} />
            <ColourField id="eb-bg" label="Page background" value={value.background} onChange={(v) => set("background", v)} issue={issueFor("background")} />
            <ColourField id="eb-card" label="Card" value={value.card} onChange={(v) => set("card", v)} issue={issueFor("card")} />
            <ColourField id="eb-text" label="Text" value={value.text} onChange={(v) => set("text", v)} issue={issueFor("text")} />
            <ColourField id="eb-muted" label="Muted text" value={value.mutedText} onChange={(v) => set("mutedText", v)} issue={issueFor("mutedText")} />
          </div>
        </SectionCard>

        {showTypography ? (
          <SectionCard title="Fonts and sizes" description="Only email-safe fonts are offered: web fonts do not load reliably in mail apps.">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="eb-font">Font</Label>
                <SimpleSelect id="eb-font" value={value.fontFamily} onChange={(v) => set("fontFamily", v)} options={FONT_OPTIONS} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="eb-size">Base size (px)</Label>
                <Input id="eb-size" type="number" min={13} max={18} value={value.baseFontSize} onChange={(e) => set("baseFontSize", Number(e.target.value))} />
                {issueFor("baseFontSize") ? <p className="text-xs text-destructive">{issueFor("baseFontSize")}</p> : null}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="eb-scale">Heading scale</Label>
                <Input id="eb-scale" type="number" min={1.2} max={2} step={0.05} value={value.headingScale} onChange={(e) => set("headingScale", Number(e.target.value))} />
                {issueFor("headingScale") ? <p className="text-xs text-destructive">{issueFor("headingScale")}</p> : <p className="text-xs text-muted-foreground">Heading = base × scale.</p>}
              </div>
            </div>
          </SectionCard>
        ) : null}

        <SectionCard title="Footer" description="Shown at the bottom of every email.">
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="eb-ftext">Message</Label>
              <Input id="eb-ftext" maxLength={300} value={value.footer.text} onChange={(e) => setFooter({ text: e.target.value })} placeholder="Thank you for shopping with us." />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="eb-faddr">Address</Label>
              <Input id="eb-faddr" maxLength={200} value={value.footer.address} onChange={(e) => setFooter({ address: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="eb-fsupport">Support email</Label>
              <Input id="eb-fsupport" type="email" value={value.footer.supportEmail} onChange={(e) => setFooter({ supportEmail: e.target.value })} />
              {issueFor("footer.supportEmail") ? <p className="text-xs text-destructive">{issueFor("footer.supportEmail")}</p> : null}
            </div>
            <div className="grid gap-2">
              <Label>Links (up to 4)</Label>
              {links.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_2fr_auto] items-center gap-2">
                  <Input aria-label={`Link ${i + 1} label`} placeholder="Label" maxLength={40} value={l.label} onChange={(e) => setFooter({ links: links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <Input aria-label={`Link ${i + 1} address`} placeholder="https://…" value={l.url} onChange={(e) => setFooter({ links: links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove link ${i + 1}`} onClick={() => setFooter({ links: links.filter((_, j) => j !== i) })}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              {issueFor("footer.links") ? <p className="text-xs text-destructive">{issueFor("footer.links")}</p> : null}
              {links.length < 4 ? (
                <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setFooter({ links: [...links, { label: "", url: "" }] })}>
                  <Plus className="size-4" /> Add link
                </Button>
              ) : null}
            </div>
          </div>
        </SectionCard>

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save branding"}
          </Button>
        </div>
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Live preview</p>
          <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Preview size">
            <button type="button" onClick={() => setDevice("desktop")} aria-pressed={device === "desktop"} className={cn("inline-flex items-center gap-1 rounded px-2 py-1 text-xs", device === "desktop" ? "bg-muted font-medium" : "text-muted-foreground")}>
              <Monitor className="size-3.5" /> Desktop
            </button>
            <button type="button" onClick={() => setDevice("mobile")} aria-pressed={device === "mobile"} className={cn("inline-flex items-center gap-1 rounded px-2 py-1 text-xs", device === "mobile" ? "bg-muted font-medium" : "text-muted-foreground")}>
              <Smartphone className="size-3.5" /> Mobile
            </button>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
          <iframe
            title="Email preview"
            // The preview is our own rendered markup with every value escaped; the sandbox still blocks scripts and navigation.
            sandbox=""
            srcDoc={previewHtml}
            className={cn("mx-auto block h-[640px] bg-white transition-all", device === "mobile" ? "w-[375px] max-w-full" : "w-full")}
          />
        </div>
      </div>
    </div>
  );
}
