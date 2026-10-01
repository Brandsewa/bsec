import { toast } from "@bs/ui";
import { useState } from "react";
import { errorMessage } from "../../lib/errors.ts";

export interface BulkProgress {
  label: string;
  done: number;
  total: number;
}

/**
 * Runs one action over many rows, one at a time, with live progress and a single summary toast
 * ("8 orders fulfilled, 1 skipped, 1 failed. ORD-3: reason"). Rows the action does not apply to are skipped, not failed.
 */
export function useBulkRunner() {
  const [progress, setProgress] = useState<BulkProgress | null>(null);

  async function run<T>(opts: {
    rows: T[];
    getId: (row: T) => string;
    getLabel: (row: T) => string;
    /** Sentence start for progress, e.g. "Fulfilling". */
    verb: string;
    /** Past participle for the summary, e.g. "fulfilled". */
    done: string;
    noun: string;
    eligible?: (row: T) => boolean;
    action: (row: T) => Promise<unknown>;
    onFinished?: (succeededIds: Set<string>) => void;
  }): Promise<void> {
    const todo = opts.eligible ? opts.rows.filter(opts.eligible) : opts.rows;
    const skipped = opts.rows.length - todo.length;
    if (todo.length === 0) {
      toast.error(`None of the selected ${opts.noun}s can be ${opts.done}.`);
      return;
    }
    const failed: string[] = [];
    const succeeded = new Set<string>();
    for (const [i, row] of todo.entries()) {
      setProgress({ label: `${opts.verb} ${opts.noun}s`, done: i, total: todo.length });
      try {
        await opts.action(row);
        succeeded.add(opts.getId(row));
      } catch (e) {
        failed.push(`${opts.getLabel(row)}: ${errorMessage(e)}`);
      }
    }
    setProgress(null);
    opts.onFinished?.(succeeded);
    const parts = [`${succeeded.size} ${opts.noun}${succeeded.size === 1 ? "" : "s"} ${opts.done}`];
    if (skipped > 0) parts.push(`${skipped} skipped (not eligible)`);
    if (failed.length > 0) {
      toast.error(`${parts.join(", ")}. ${failed.length} failed. ${failed[0]}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ""}`);
    } else {
      toast.success(`${parts.join(", ")}.`);
    }
  }

  return { progress, setProgress, run, busy: progress !== null };
}
