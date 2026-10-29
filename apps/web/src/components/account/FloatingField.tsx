import React from "react";

// The same field as the checkout form: the name sits inside the box, then shrinks to the top edge once there is text or focus.
const FIELD_CLASS =
  "bs-field peer h-12 w-full rounded-lg border px-3 pb-1 pt-5 text-sm text-foreground placeholder-transparent transition-colors hover:border-border focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15";
const FLOAT_LABEL =
  "pointer-events-none absolute left-3 top-3 origin-left text-sm text-muted-foreground transition-all peer-focus:top-1.5 peer-focus:text-[11px] peer-[:not(:placeholder-shown)]:top-1.5 peer-[:not(:placeholder-shown)]:text-[11px]";

export function FloatingField({
  id,
  label,
  value,
  onChange,
  required = false,
  maxLength,
  inputMode,
  pattern,
  type = "text",
  autoComplete,
  minLength,
  disabled = false,
  trailing,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  maxLength?: number;
  inputMode?: "numeric" | "tel" | "text";
  pattern?: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
  disabled?: boolean;
  /** A small control drawn inside the right edge, such as a show-password button. */
  trailing?: React.ReactNode;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type={type}
        required={required}
        maxLength={maxLength}
        minLength={minLength}
        autoComplete={autoComplete}
        disabled={disabled}
        inputMode={inputMode}
        pattern={pattern}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder=" "
        className={`${FIELD_CLASS}${trailing ? " pr-11" : ""}${disabled ? " opacity-70" : ""}`}
      />
      <label htmlFor={id} className={FLOAT_LABEL}>
        {label}
        {required ? " *" : ""}
      </label>
      {trailing}
    </div>
  );
}

/** The same in-field title, for a few lines of free text. */
export function FloatingTextarea({
  id,
  label,
  value,
  onChange,
  maxLength,
  rows = 3,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  rows?: number;
}) {
  return (
    <div className="relative">
      <textarea
        id={id}
        rows={rows}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder=" "
        className={`${FIELD_CLASS} h-auto resize-none pt-6`}
      />
      <label htmlFor={id} className={FLOAT_LABEL}>
        {label}
      </label>
    </div>
  );
}
