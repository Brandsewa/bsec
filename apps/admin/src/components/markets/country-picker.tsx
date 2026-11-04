import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input } from "@bs/ui";
import { orpc } from "../../lib/orpc.ts";
import { MARKET_COUNTRY_OPTIONS } from "./types.ts";

/** Countries already used by the store's other markets (code to market name): a country can be in only one market. */
export function useTakenCountries(exceptMarketId?: string): Record<string, string> {
  const markets = useQuery(orpc.admin.markets.list.queryOptions({}));
  const taken: Record<string, string> = {};
  for (const m of markets.data?.markets ?? []) {
    if (m.id === exceptMarketId) continue;
    for (const c of m.countries) taken[c] = m.name;
  }
  return taken;
}

/**
 * Country chooser for a market: a field that lists what is chosen, and a pop-up with search, a checkbox per country and
 * select all / clear all for the countries shown. Changes apply on Done, so Cancel leaves the market untouched.
 */
export function CountryPicker({ value, onChange, id, taken = {} }: { value: string[]; onChange: (next: string[]) => void; id?: string; taken?: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(value);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? MARKET_COUNTRY_OPTIONS.filter((o) => o.label.toLowerCase().includes(q)) : MARKET_COUNTRY_OPTIONS;
  }, [query]);
  const chosen = new Set(draft);
  const selectable = visible.filter((o) => !taken[o.value]);
  const allVisibleChosen = selectable.length > 0 && selectable.every((o) => chosen.has(o.value));
  const someVisibleChosen = selectable.some((o) => chosen.has(o.value));

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
      const shown = new Set(selectable.map((o) => o.value));
      return allVisibleChosen ? d.filter((c) => !shown.has(c)) : [...d, ...selectable.map((o) => o.value).filter((c) => !d.includes(c))];
    });
  }

  return (
    <>
      <div>
        <Button id={id} type="button" variant="outline" size="sm" onClick={openPicker}>
          {value.length === 0 ? "Choose countries" : `${value.length} ${value.length === 1 ? "country" : "countries"} selected, change`}
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
              {query.trim() ? `Select all ${selectable.length} matching` : `Select all ${selectable.length} available`}
              <span className="ml-auto font-normal text-muted-foreground">{draft.length} selected</span>
            </label>
            <ul className="max-h-[22rem] overflow-y-auto">
              {visible.length === 0 ? <li className="px-3 py-6 text-center text-xs text-muted-foreground">No country matches.</li> : null}
              {visible.map((o) => (
                <li key={o.value} className="border-b border-border/60 last:border-b-0">
                  <label className={`flex items-center gap-3 px-3 py-2 text-sm ${taken[o.value] ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-muted/40"}`}>
                    <input type="checkbox" checked={chosen.has(o.value)} disabled={!!taken[o.value]} onChange={() => toggle(o.value)} className="h-3.5 w-3.5" />
                    {o.label}
                    {taken[o.value] ? <span className="ml-auto text-[11px] text-muted-foreground">In {taken[o.value]}</span> : null}
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
