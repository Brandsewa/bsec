import { useMemo } from "react";
import { FieldLabel, InfoTip } from "@bs/ui";
import type { PolicyBlock, RichDescription } from "@bs/contracts";
import PolicyRichEditor from "./policy-rich-editor.tsx";

/**
 * The long, formatted description of a category or collection: the same rich text editor and validated block
 * format as the policies, so no HTML is stored (ADR-010). An empty editor saves as no description.
 */
export function RichDescriptionField({
  id,
  value,
  onChange,
  tip,
}: {
  id: string;
  /** The stored value; the editor owns the content after it loads. */
  value: RichDescription | null | undefined;
  onChange: (value: RichDescription | null) => void;
  tip: string;
}) {
  const initial = useMemo<PolicyBlock[]>(() => value?.blocks ?? [], [value]);
  return (
    <div className="grid gap-1.5">
      <FieldLabel htmlFor={id} className="flex items-center gap-1.5">
        Long description
        <InfoTip>{tip}</InfoTip>
      </FieldLabel>
      <div id={id}>
        <PolicyRichEditor initialBlocks={initial} resetKey={id} onChange={(blocks) => onChange(blocks.length > 0 ? { v: 1, blocks } : null)} />
      </div>
    </div>
  );
}
