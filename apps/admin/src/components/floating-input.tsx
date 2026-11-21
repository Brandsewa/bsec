import { useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

// Same pattern as the storefront checkout form: the name sits inside the box, then shrinks to the top edge once there is text or focus.
const FIELD =
  "peer h-14 w-full rounded-lg border border-border bg-background px-3.5 pb-1.5 pt-6 text-base text-foreground placeholder-transparent transition-colors hover:border-foreground/30 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-70";
const LABEL =
  "pointer-events-none absolute left-3.5 top-4 origin-left text-base text-muted-foreground transition-all peer-focus:top-2 peer-focus:text-xs peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-xs";

export function FloatingInput({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  required = false,
  trailing,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  trailing?: ReactNode;
  inputMode?: "text" | "numeric";
}) {
  return (
    <div className="relative">
      <input id={id} type={type} value={value} required={required} autoComplete={autoComplete} inputMode={inputMode} placeholder=" " onChange={(e) => onChange(e.target.value)} className={`${FIELD}${trailing ? " pr-12" : ""}`} />
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {trailing}
    </div>
  );
}

/** A floating-label password field with a show/hide button inside the right edge. */
export function FloatingPassword(props: Omit<Parameters<typeof FloatingInput>[0], "type" | "trailing">) {
  const [shown, setShown] = useState(false);
  return (
    <FloatingInput
      {...props}
      type={shown ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          {shown ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      }
    />
  );
}
