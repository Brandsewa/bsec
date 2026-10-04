import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

export interface DropdownOption {
  value: string;
  label: string;
}

/**
 * A styled single-choice dropdown (the browser's native list cannot be styled). Keyboard: arrows move,
 * Enter or Space picks, Escape closes. The list is positioned from the button's box (fixed), so the
 * sidebar's scrolling and overflow never clip it.
 */
export function Dropdown({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  compact,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean | undefined;
  ariaLabel: string;
  /** Smaller control for toolbars (12px text, shorter box). */
  compact?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value);

  const show = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const flip = below < 180 && above > below;
    const maxHeight = Math.min(280, flip ? above : below);
    const height = Math.min(maxHeight, options.length * 36 + 10);
    setBox({ top: flip ? r.top - height - 6 : r.bottom + 6, left: r.left, width: r.width, maxHeight });
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = () => setOpen(false);
  const pick = (o: DropdownOption) => {
    onChange(o.value);
    setOpen(false);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!button.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) setOpen(false);
    };
    const dismiss = (e: Event) => {
      // Scrolling inside the list itself must not close it.
      if (e.target instanceof Node && list.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) (list.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const o = options[active];
      if (o) pick(o);
    } else if (e.key === "Tab") {
      close();
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
        style={{ ...style.button, ...(compact ? style.buttonCompact : null), ...(open ? style.buttonOpen : null), ...(disabled ? { opacity: 0.6, cursor: "not-allowed" } : null) }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current?.label ?? "Select"}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          stroke="#71717a"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flex: "none", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
        >
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>
      {open && box ? (
        <ul ref={list} role="listbox" aria-label={ariaLabel} style={{ ...style.list, top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight }}>
          {options.map((o, i) => {
            const selected = o.value === value;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
                style={{ ...style.option, ...(compact ? style.optionCompact : null), ...(i === active ? style.optionActive : null), ...(selected ? { fontWeight: 600 } : null) }}
              >
                <span>{o.label}</span>
                {selected ? (
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 10.5l4 4 8-9" />
                  </svg>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

const style = {
  button: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    border: "1px solid #e4e4e7",
    borderRadius: 8,
    background: "#fafafa",
    padding: "8px 10px",
    fontSize: 13,
    color: "#18181b",
    textAlign: "left",
    cursor: "pointer",
  } as CSSProperties,
  buttonCompact: { padding: "4px 8px", fontSize: 12, borderRadius: 7, minHeight: 26 } as CSSProperties,
  optionCompact: { padding: "5px 8px", fontSize: 12 } as CSSProperties,
  buttonOpen: { borderColor: "#2563eb", background: "#fff", boxShadow: "0 0 0 3px rgba(37,99,235,.15)" } as CSSProperties,
  list: {
    position: "fixed",
    zIndex: 100000,
    margin: 0,
    padding: 4,
    listStyle: "none",
    overflowY: "auto",
    background: "#fff",
    border: "1px solid #e4e4e7",
    borderRadius: 10,
    boxShadow: "0 12px 32px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.06)",
  } as CSSProperties,
  option: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderRadius: 6, fontSize: 13, color: "#18181b", cursor: "pointer" } as CSSProperties,
  optionActive: { background: "#f1f5f9" } as CSSProperties,
};
