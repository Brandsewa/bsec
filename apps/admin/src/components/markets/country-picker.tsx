import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from "@bs/ui";
import { MARKET_COUNTRY_OPTIONS } from "./types.ts";

const NAME_OF = new Map(MARKET_COUNTRY_OPTIONS.map((o) => [o.value, o.label]));

/**
 * Country chooser for a market: a field that lists what is chosen, and a pop-up with search, a checkbox per country and
 * select all / clear all for the countries shown. Changes apply on Done, so Cancel leaves the market untouched.
 */
export function CountryPicker({ value, onChange, id }: { value: string[]; onChange: (next: string[]) => void; id?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? MARKET_COUNTRY_OPTIONS.filter((o) => o.label.toLowerCase().includes(q)) : MARKET_COUNTRY_OPTIONS;
  }, [query]);
  const chosen = new Set(draft);
  const allVisibleChosen = visible.length > 0 && visible.every((o) => chosen.has(o.value));
  const someVisibleChosen = visible.some((o) => chosen.has(o.value));

  function openPicker() {
    setDraft(value);
    setQuery("");
    setOpen(true);
  }
  function toggle(code: string) {
    setDraft((d) => (d.includes(code) ? d.filter((c) => c !== code) : [...d, code]));
  }
  function toggleAllVisible() {
    setDraft((d) => {
      const shown = new Set(visible.map((o) => o.value));
      return allVisibleChosen ? d.filter((c) => !shown.has(c)) : [...d, ...visible.map((o) => o.value).filter((c) => !d.includes(c))];
    });
  }

  return (
    <>
      <div className="rounded-md border border-border bg-background p-2">
        {value.length > 0 ? (
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {value.slice(0, 12).map((code) => (
              <li key={code} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                {NAME_OF.get(code) ?? code}
                <button type="button" aria-label={`Remove ${NAME_OF.get(code) ?? code}`} onClick={() => onChange(value.filter((c) => c !== code))} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
            {value.length > 12 ? <li className="px-1 text-[11px] text-muted-foreground">+{value.length - 12} more</li> : null}
          </ul>
        ) : null}
        <Button id={id} type="button" variant="outline" size="sm" onClick={openPicker}>
          {value.length === 0 ? "Choose countries" : `${value.length} selected, change`}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Select countries</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search countries" aria-label="Search countries" className="pl-8" />
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            <label className="flex cursor-pointer items-center gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={allVisibleChosen}
                ref={(el) => {
                  if (el) el.indeterminate = !allVisibleChosen && someVisibleChosen;
                }}
                onChange={toggleAllVisible}
                className="h-3.5 w-3.5"
              />
              {query.trim() ? `Select all ${visible.length} matching` : `Select all ${visible.length} countries`}
              <span className="ml-auto font-normal text-muted-foreground">{draft.length} selected</span>
            </label>
            <ul className="max-h-[22rem] overflow-y-auto">
              {visible.length === 0 ? <li className="px-3 py-6 text-center text-xs text-muted-foreground">No country matches.</li> : null}
              {visible.map((o) => (
                <li key={o.value} className="border-b border-border/60 last:border-b-0">
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                    <input type="checkbox" checked={chosen.has(o.value)} onChange={() => toggle(o.value)} className="h-3.5 w-3.5" />
                    {o.label}
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" size="sm" disabled={draft.length === 0} onClick={() => setDraft([])}>
              Clear all
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onChange(draft);
                  setOpen(false);
                }}
              >
                Done
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
