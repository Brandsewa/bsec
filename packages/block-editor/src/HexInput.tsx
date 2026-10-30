import { useState, type CSSProperties } from "react";

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Text box for a hex colour. It keeps what the person is typing in its own draft and only passes a finished colour (#rgb or #rrggbb) up,
 * so typing works one character at a time even when the owner of the value ignores half-typed colours.
 * Leaving the box with something that is not a colour puts the last good value back (or clears it when `onClear` is given and the box is empty).
 */
export function HexInput({
  value,
  onCommit,
  onClear,
  ariaLabel,
  disabled,
  style,
}: {
  value: string | undefined;
  onCommit: (hex: string) => void;
  onClear?: (() => void) | undefined;
  ariaLabel: string;
  disabled?: boolean | undefined;
  style?: CSSProperties | undefined;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [seen, setSeen] = useState(value);

  // A new value from outside (the picker, a reset, a palette swatch) replaces the draft.
  if (value !== seen) {
    setSeen(value);
    setDraft(value ?? "");
  }

  const normalise = (raw: string) => {
    const t = raw.trim();
    return HEX.test(t) ? t : HEX.test(`#${t}`) ? `#${t}` : null;
  };

  return (
    <input
      type="text"
      aria-label={ariaLabel}
      value={draft}
      placeholder="#000000"
      maxLength={7}
      spellCheck={false}
      autoComplete="off"
      disabled={disabled}
      onChange={(e) => {
        setDraft(e.target.value);
        const ok = normalise(e.target.value);
        if (ok) onCommit(ok);
      }}
      onBlur={() => {
        const ok = normalise(draft);
        if (ok) {
          setDraft(ok);
          if (ok !== value) onCommit(ok);
        } else if (draft.trim() === "" && onClear) {
          onClear();
        } else {
          setDraft(value ?? "");
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      style={style}
    />
  );
}
