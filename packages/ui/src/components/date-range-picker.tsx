import { endOfMonth, format, isValid, parse, startOfMonth, startOfToday, subDays } from "date-fns";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Button } from "./ui/button.tsx";
import { Calendar } from "./ui/calendar.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { useIsMobile } from "../hooks/use-mobile.ts";

const ISO = "yyyy-MM-dd";
const toDate = (s?: string) => {
  if (!s) return undefined;
  const d = parse(s, ISO, new Date());
  return isValid(d) ? d : undefined;
};

const PRESETS: ReadonlyArray<{ label: string; range: () => DateRange }> = [
  { label: "Today", range: () => ({ from: startOfToday(), to: startOfToday() }) },
  { label: "Yesterday", range: () => ({ from: subDays(startOfToday(), 1), to: subDays(startOfToday(), 1) }) },
  { label: "Last 7 days", range: () => ({ from: subDays(startOfToday(), 6), to: startOfToday() }) },
  { label: "Last 30 days", range: () => ({ from: subDays(startOfToday(), 29), to: startOfToday() }) },
  { label: "This month", range: () => ({ from: startOfMonth(startOfToday()), to: endOfMonth(startOfToday()) }) },
];

/** What the trigger button says for the current range. */
function summary(from?: string, to?: string, empty = "Any date"): string {
  const f = toDate(from);
  const t = toDate(to);
  if (f && t) return from === to ? format(f, "d MMM yyyy") : `${format(f, "d MMM")} – ${format(t, "d MMM yyyy")}`;
  if (f) return `From ${format(f, "d MMM yyyy")}`;
  if (t) return `Until ${format(t, "d MMM yyyy")}`;
  return empty;
}

export interface DateRangePickerProps {
  from?: string | undefined;
  to?: string | undefined;
  onChange: (from: string | undefined, to: string | undefined) => void;
  emptyLabel?: string;
  className?: string;
}

/**
 * One calendar to pick a start and an end date. Values are yyyy-MM-dd strings (URL-friendly).
 * Presets apply straight away; picking by hand needs Apply so a half-chosen range never filters the table.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  emptyLabel = "Any date",
  className,
}: DateRangePickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();

  const commit = (r: DateRange | undefined) => {
    // A single clicked day is a one-day range.
    const f = r?.from;
    const t = r?.to ?? r?.from;
    onChange(f ? format(f, ISO) : undefined, t ? format(t, ISO) : undefined);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft({ from: toDate(from), to: toDate(to) });
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className={className} aria-label={`Date range: ${summary(from, to, emptyLabel)}`} />
        }
      >
        <CalendarDays className="mr-1.5 size-3.5" aria-hidden />
        <span className={from || to ? "text-foreground" : "text-muted-foreground"}>{summary(from, to, emptyLabel)}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-0 p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex gap-1 overflow-x-auto border-b border-border p-2 sm:w-36 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0">
            {PRESETS.map((p) => (
              <Button key={p.label} variant="ghost" size="sm" className="justify-start whitespace-nowrap" onClick={() => commit(p.range())}>
                {p.label}
              </Button>
            ))}
          </div>
          <div>
            <Calendar
              mode="range"
              numberOfMonths={isMobile ? 1 : 2}
              selected={draft}
              onSelect={setDraft}
              defaultMonth={draft?.from ?? startOfToday()}
              disabled={{ after: startOfToday() }}
              autoFocus
            />
            <div className="flex items-center justify-between gap-2 border-t border-border p-2">
              <span className="text-muted-foreground">
                {draft?.from ? summary(format(draft.from, ISO), draft.to ? format(draft.to, ISO) : format(draft.from, ISO)) : "Pick a start and end date"}
              </span>
              <div className="flex gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => commit(undefined)}>
                  Clear
                </Button>
                <Button size="sm" disabled={!draft?.from} onClick={() => commit(draft)}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

