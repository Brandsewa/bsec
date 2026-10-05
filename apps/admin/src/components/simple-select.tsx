import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@bs/ui";

export interface SelectOption {
  value: string;
  label: string;
}

/** Optional grouping for the dropdown (rendered as labelled, non-selectable headings). */
export interface SelectOptionGroup {
  label: string;
  options: ReadonlyArray<SelectOption>;
}

/**
 * A styled dropdown for a short list of options (replaces the browser's native <select>, whose popup cannot be themed).
 * `value=""` shows the placeholder. `id` goes on the trigger so a <label htmlFor> works.
 */
export function SimpleSelect({
  id,
  value,
  onChange,
  options,
  groups,
  placeholder,
  ariaLabel,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<SelectOption>;
  groups?: ReadonlyArray<SelectOptionGroup>;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const flat = groups ? groups.flatMap((g) => g.options) : options;
  return (
    <Select<string> items={flat} value={value === "" ? null : value} onValueChange={(v) => onChange(v ?? "")}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className ?? "w-full"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-h-72 min-w-44">
        {groups
          ? groups.map((g) => (
              <SelectGroup key={g.label} aria-label={g.label}>
                <SelectLabel>{g.label}</SelectLabel>
                {g.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))
          : options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
      </SelectContent>
    </Select>
  );
}
