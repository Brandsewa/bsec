import { useEffect, useState } from "react";
import type { CustomField } from "@puckeditor/core";
import { useHost } from "./context.tsx";

const box = { border: "1px solid #ddd", borderRadius: 6, padding: "6px 8px", fontSize: 13, width: "100%" } as const;

function MenuSelect({
  value,
  onChange,
  name,
  label,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  name: string;
  label: string;
}) {
  const host = useHost();
  const [menus, setMenus] = useState<Array<{ handle: string; title: string }>>([
    { handle: "header", title: "Header menu (header)" },
    { handle: "footer", title: "Footer menu (footer)" },
  ]);

  useEffect(() => {
    let mounted = true;
    if (host?.listMenus) {
      host
        .listMenus()
        .then((list) => {
          if (mounted && Array.isArray(list)) {
            const map = new Map<string, string>();
            map.set("header", "Header menu (header)");
            map.set("footer", "Footer menu (footer)");
            for (const m of list) {
              map.set(m.handle, `${m.title} (${m.handle})`);
            }
            setMenus(Array.from(map.entries()).map(([handle, title]) => ({ handle, title })));
          }
        })
        .catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, [host]);

  const currentValue = value ?? "";
  const hasOption = menus.some((m) => m.handle === currentValue);

  return (
    <div>
      <label htmlFor={name} style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
        {label}
      </label>
      <select
        id={name}
        value={currentValue}
        onChange={(e) => onChange(e.target.value || undefined)}
        style={box}
      >
        <option value="">Default menu</option>
        {menus.map((m) => (
          <option key={m.handle} value={m.handle}>
            {m.title}
          </option>
        ))}
        {!hasOption && currentValue ? (
          <option value={currentValue}>{currentValue} (custom)</option>
        ) : null}
      </select>
      <span style={{ fontSize: 11, color: "#666", display: "block", marginTop: 4 }}>
        Choose a menu created in Online Store &gt; Navigation
      </span>
    </div>
  );
}

export function menuField(label: string): CustomField<string | undefined> {
  return {
    type: "custom",
    label,
    render: ({ value, onChange, name }) => (
      <MenuSelect value={value} onChange={onChange} name={name} label={label} />
    ),
  };
}
