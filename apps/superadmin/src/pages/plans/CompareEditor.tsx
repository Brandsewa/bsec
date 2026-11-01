import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, InfoTip, Input, SimpleSelect, Switch, toast } from "@bs/ui";
import { PLAN_LIMIT_KEYS, PLAN_LIMIT_LABELS, type PlanCell, type PlanCompareRowInput, type PlanEditorView, type PlanLimitKey } from "@bs/contracts";
import { client } from "../../lib/orpc.ts";
import { messageOf } from "../../lib/errors.ts";

type Draft = PlanCompareRowInput & { key: string };

const CELL_OPTIONS = [
  { value: "tick", label: "Tick" },
  { value: "none", label: "Dash" },
  { value: "text", label: "Text" },
  { value: "soon", label: "Soon" },
];
const LIMIT_OPTIONS = [{ value: "", label: "Not a limit" }, ...PLAN_LIMIT_KEYS.map((k) => ({ value: k, label: PLAN_LIMIT_LABELS[k] }))];

let counter = 0;
const toDrafts = (rows: PlanEditorView["compareRows"]): Draft[] =>
  rows.map((r) => ({
    key: r.id,
    groupName: r.groupName,
    label: r.label,
    tooltip: r.tooltip,
    limitKey: r.limitKey,
    cells: r.cells,
    isVisible: r.isVisible,
  }));

/** The long comparison table merchants see, editable row by row. Limit rows print the enforced value, so they have no cells to edit. */
export function CompareEditor({ view, onSaved }: { view: PlanEditorView; onSaved: () => void }) {
  const [rows, setRows] = useState<Draft[]>(() => toDrafts(view.compareRows));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const plans = view.plans;

  const groups = useMemo(() => [...new Set(rows.map((r) => r.groupName))], [rows]);

  function update(key: string, patch: Partial<Draft>) {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  }
  function setCell(key: string, planCode: string, cell: PlanCell) {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, cells: { ...r.cells, [planCode]: cell } } : r)));
    setDirty(true);
  }
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j] as Draft, next[i] as Draft];
    setRows(next);
    setDirty(true);
  }
  function addRow() {
    const last = rows[rows.length - 1];
    setRows([...rows, { key: `new-${++counter}`, groupName: last?.groupName ?? "Core store", label: "", tooltip: null, limitKey: null, cells: {}, isVisible: true }]);
    setDirty(true);
  }

  async function save() {
    const clean = rows.filter((r) => r.label.trim());
    setSaving(true);
    try {
      await client.plans.saveCompare({
        rows: clean.map(({ key: _key, ...r }) => ({ ...r, groupName: r.groupName.trim() || "Other", label: r.label.trim() })),
      });
      toast.success("Comparison table saved");
      setDirty(false);
      onSaved();
    } catch (err) {
      toast.error(messageOf(err, "Could not save the comparison table"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            Compare all features
            <InfoTip>
              This is the long table merchants open from the plan cards. Rows linked to a limit print the enforced number for each plan, so they
              update when you change a limit. Other rows take a tick, a dash, a short text or a "Soon" tag per plan. Nothing is live until you save.
            </InfoTip>
          </h2>
          <p className="text-xs text-muted-foreground">{rows.length} rows in {groups.length} groups</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-1 h-4 w-4" /> Add row
          </Button>
          <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={() => { setRows(toDrafts(view.compareRows)); setDirty(false); }}>
            Discard
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save table"}
          </Button>
        </div>
      </div>

      <datalist id="plan-compare-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Group</th>
              <th className="px-3 py-2 font-medium">Row</th>
              <th className="px-3 py-2 font-medium">Linked limit</th>
              {plans.map((p) => (
                <th key={p.code} className="px-3 py-2 font-medium">{p.name}</th>
              ))}
              <th className="px-3 py-2 font-medium">Shown</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-b border-border/60 align-top last:border-0">
                <td className="px-3 py-2">
                  <Input list="plan-compare-groups" value={r.groupName} onChange={(e) => update(r.key, { groupName: e.target.value })} className="h-8 w-36" aria-label="Group" />
                </td>
                <td className="px-3 py-2">
                  <Input value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} className="h-8 w-56" aria-label="Row label" />
                  <Input
                    value={r.tooltip ?? ""}
                    onChange={(e) => update(r.key, { tooltip: e.target.value || null })}
                    className="mt-1 h-7 w-56 text-xs"
                    placeholder="Hint shown behind an info icon"
                    aria-label="Row hint"
                  />
                </td>
                <td className="px-3 py-2">
                  <SimpleSelect
                    value={r.limitKey ?? ""}
                    onChange={(v) => update(r.key, { limitKey: v ? (v as PlanLimitKey) : null })}
                    options={LIMIT_OPTIONS}
                    ariaLabel="Linked limit"
                    className="w-40"
                  />
                </td>
                {plans.map((p) => {
                  const cell = r.cells[p.code] ?? { k: "none" as const };
                  if (r.limitKey) {
                    return (
                      <td key={p.code} className="px-3 py-2 text-xs text-muted-foreground">
                        enforced limit
                      </td>
                    );
                  }
                  return (
                    <td key={p.code} className="px-3 py-2">
                      <SimpleSelect value={cell.k} onChange={(v) => setCell(r.key, p.code, { k: v as PlanCell["k"], ...(v === "text" ? { t: cell.t ?? "" } : {}) })} options={CELL_OPTIONS} ariaLabel={`${p.name} cell`} className="w-24" />
                      {cell.k === "text" ? (
                        <Input value={cell.t ?? ""} onChange={(e) => setCell(r.key, p.code, { k: "text", t: e.target.value })} className="mt-1 h-7 w-24 text-xs" maxLength={80} aria-label={`${p.name} text`} />
                      ) : null}
                    </td>
                  );
                })}
                <td className="px-3 py-2">
                  <Switch checked={r.isVisible} onCheckedChange={(v) => update(r.key, { isVisible: v })} aria-label="Shown to merchants" />
                </td>
                <td className="px-3 py-2">
                  <div className="flex">
                    <Button type="button" variant="ghost" size="icon" onClick={() => move(i, -1)} aria-label="Move up">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => move(i, 1)} aria-label="Move down">
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => { setRows((all) => all.filter((x) => x.key !== r.key)); setDirty(true); }} aria-label="Delete row">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
