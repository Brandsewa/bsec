import { useSyncExternalStore } from "react";
import { AutoField, FieldLabel, type CustomField, type Field } from "@puckeditor/core";

/**
 * Accordion sections for a block's field panel. Puck renders every field of a block in one flat
 * list; for blocks with many settings that is a wall of inputs. A section is a header field plus the
 * fields that belong to it; each of those is wrapped so it renders nothing while its section is closed
 * (and its empty row is hidden by CSS, see compact.ts). The stored props stay flat and unchanged: the
 * header fields are display-only and carry no data.
 *
 * Which sections are open is editor UI state, kept per section id here and shared by all blocks.
 */

const open = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const toggle = (id: string) => {
  if (open.has(id)) open.delete(id);
  else open.add(id);
  listeners.forEach((l) => l());
};
const useOpen = (id: string) => useSyncExternalStore(subscribe, () => open.has(id), () => false);

/** Prefix of the display-only header fields; they are not block props. */
export const SECTION_PREFIX = "__section_";

function Header({ id, title, count }: { id: string; title: string; count?: number | undefined }) {
  const isOpen = useOpen(id);
  return (
    <div data-sec-header="">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => toggle(id)}
        style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8, border: 0, background: "none", padding: "9px 8px", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#18181b", textAlign: "left" }}
      >
        <span>
          {title}
          {count !== undefined ? <span style={{ marginLeft: 6, fontWeight: 500, color: "#71717a" }}>{count}</span> : null}
        </span>
        <span aria-hidden="true" style={{ fontSize: 10, color: "#71717a", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
          ▾
        </span>
      </button>
    </div>
  );
}

function Gate({ id, children }: { id: string; children: React.ReactNode }) {
  const isOpen = useOpen(id);
  return isOpen ? <div data-sec-field="">{children}</div> : <span data-sec-closed="" hidden />;
}

export interface FieldSection {
  id: string;
  title: string;
  fields: Record<string, Field>;
}

/** Turns grouped fields into one ordered flat field map: header, then the section's fields, per section. */
export function accordionFields(blockType: string, sections: FieldSection[]): Record<string, Field> {
  const out: Record<string, Field> = {};
  for (const section of sections) {
    const id = `${blockType}:${section.id}`;
    out[`${SECTION_PREFIX}${section.id}`] = { type: "custom", label: section.title, render: () => <Header id={id} title={section.title} /> } as CustomField<undefined>;
    for (const [name, field] of Object.entries(section.fields)) {
      out[name] = {
        type: "custom",
        label: (field as { label?: string }).label ?? name,
        render: ({ value, onChange }: { value: unknown; onChange: (v: any) => void }) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
          <Gate id={id}>
            {/* Custom fields draw their own label; AutoField draws none for the built-in kinds. */}
            {field.type === "custom" ? (
              <AutoField field={field} value={value} onChange={onChange} />
            ) : (
              <FieldLabel label={(field as { label?: string }).label ?? name}>
                <AutoField field={field} value={value} onChange={onChange} />
              </FieldLabel>
            )}
          </Gate>
        ),
      } as CustomField<unknown>;
    }
  }
  return out;
}
