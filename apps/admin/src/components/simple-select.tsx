import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface SelectOption {
  value: string;
  label: string;
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
  placeholder,
  ariaLabel,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<SelectOption>;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Select items={options} value={value === "" ? null : value} onValueChange={(v) => onChange(v ?? "")}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className ?? "w-full"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-h-72 min-w-44">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
