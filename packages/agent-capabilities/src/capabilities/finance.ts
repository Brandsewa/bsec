import { z } from "zod";
import { getFinanceOverview, listExpenses } from "@bs/domain";
import { pageInput, pageParams, toPage } from "../shape.ts";
import { defineCapability } from "../types.ts";

const Period = z.enum(["7d", "30d", "90d", "ytd", "all"]);

export const getFinanceSummaryCap = defineCapability({
  name: "get_finance_summary",
  title: "Profit and loss summary",
  description:
    "Profit and loss for a period (7d, 30d, 90d, ytd, all) from the store's books: income, expenses and profit, plus cash position. Money is in minor units (paise).",
  resource: "finance",
  action: "read",
  kind: "report",
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ period: Period.default("30d") }),
  async handler({ rt, session }, input) {
    const o = await getFinanceOverview(rt._db, session.ctx, { named: input.period });
    return { period: input.period, profitAndLoss: o.profitAndLoss, cashPosition: o.cashPosition };
  },
});

export const listExpensesCap = defineCapability({
  name: "list_expenses",
  title: "List expenses",
  description: "Recorded business expenses for a period with category, payee, amount (minor units) and date. Read only.",
  resource: "finance",
  action: "read",
  kind: "read",
  userText: true,
  annotations: { readOnly: true, destructive: false, idempotent: true },
  input: z.object({ period: Period.default("30d"), category: z.string().max(60).optional(), ...pageInput }),
  async handler({ rt, session }, input) {
    const { limit, offset } = pageParams(input);
    const r = await listExpenses(rt._db, session.ctx, { period: input.period, ...(input.category ? { category: input.category } : {}), limit, offset });
    const rows = (r as unknown as { items?: Array<Record<string, unknown>>; total?: number }).items ?? [];
    const total = (r as unknown as { total?: number }).total ?? rows.length;
    return toPage(
      rows.map((e) => ({ id: e.id, date: e.date, category: e.category, payee: e.payee, amount: e.amount, paidFrom: e.paidFrom, note: e.note })),
      total,
      offset,
      limit,
    );
  },
});

export const financeCapabilities = [getFinanceSummaryCap, listExpensesCap];
