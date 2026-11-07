import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, FieldDescription } from "@bs/ui";
import { formatMoney } from "@bs/contracts/money";
import { orpc } from "../../lib/orpc.ts";
import { useStoreCurrency } from "../../lib/use-store-currency.ts";

/** How the discount has done: orders, what it gave away, what those orders were worth, and the last weeks day by day. */
export function DiscountPerformanceCard({ discountId }: { discountId: string }) {
  const currency = useStoreCurrency();
  const stats = useQuery(orpc.admin.discounts.stats.queryOptions({ input: { id: discountId, days: 30 } }));
  const s = stats.data;
  const peak = Math.max(1, ...(s?.byDay ?? []).map((d) => d.uses));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance</CardTitle>
        <CardDescription>Orders that used this discount (cancelled orders are not counted).</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {stats.isLoading ? (
          <FieldDescription>Loading…</FieldDescription>
        ) : !s || s.uses === 0 ? (
          <FieldDescription>Not used on an order yet.</FieldDescription>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Orders", String(s.uses)],
                ["Customers", String(s.customers)],
                ["Given away", formatMoney(s.totalGivenAway, currency)],
                ["Order value", formatMoney(s.revenue, currency)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md bg-muted/40 p-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-muted-foreground">
              Average order {formatMoney(s.averageOrderValue, currency)}.
              {s.otherCurrencyUses > 0 ? ` ${s.otherCurrencyUses} order${s.otherCurrencyUses === 1 ? "" : "s"} in another market's currency are counted as orders but not in the amounts.` : ""}
            </p>
            {s.byDay.length > 0 ? (
              <ul className="grid gap-1" aria-label="Orders per day, last 30 days">
                {s.byDay.slice(-14).map((d) => (
                  <li key={d.date} className="grid grid-cols-[6rem_1fr_auto] items-center gap-2">
                    <span className="text-muted-foreground">{d.date}</span>
                    <span className="h-2 rounded-full bg-muted">
                      <span className="block h-2 rounded-full bg-primary" style={{ width: `${Math.round((d.uses / peak) * 100)}%` }} />
                    </span>
                    <span>
                      {d.uses} · {formatMoney(d.amount, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
