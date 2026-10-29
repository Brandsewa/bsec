import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerReturnDetail } from "@bs/domain";
import { accountContext } from "@/server/customer-session.ts";
import { StatusBadge, Money } from "@bs/ui";
import { CancelReturnButton } from "@/components/account/CancelReturnButton.tsx";
import { describeReturnStatus, returnProgress, RETURN_STEPS } from "@/components/account/return-labels.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const card = "rounded-lg border border-[var(--border)] bg-[var(--muted)] p-5 text-sm";
const heading = "mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]";
const when = (d: Date) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default async function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await accountContext();
  if (!ctx) return null;
  if (!UUID.test(id)) notFound();
  const ret = await getCustomerReturnDetail(ctx.store.rt._db.db, ctx.store.tenantId, ctx.customer.id, id);
  if (!ret) notFound();
  const st = describeReturnStatus(ret.status);
  const done = returnProgress(ret.status);
  const exchange = ret.resolution === "replacement";

  return (
    <div>
      <Link href="/account/returns" className="mb-4 inline-block text-sm font-semibold text-[var(--brand-ink)] transition-opacity hover:opacity-70">
        ← All returns
      </Link>

      <div className="flex flex-col items-start justify-between gap-3 pb-6 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold text-[var(--foreground)]">{ret.number}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--muted-foreground)]">
            <span>Requested {when(ret.createdAt)}</span>
            <StatusBadge tone={st.tone} label={st.label} />
            <span>
              For order{" "}
              <Link href={`/account/orders/${ret.order.id}`} className="font-semibold text-[var(--brand-ink)] hover:opacity-70">
                {ret.order.number}
              </Link>
            </span>
          </div>
        </div>
        {ret.status === "requested" ? <CancelReturnButton returnId={ret.id} /> : null}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* progress first on phones, on the right on wide screens (same as the order page) */}
        <div className="space-y-6 lg:order-2">
          <div className={card}>
            {done > 0 ? (
              <ol className="grid grid-cols-5 gap-1" aria-label="Return progress">
                {RETURN_STEPS.map((label, i) => (
                  <li key={label} aria-current={i === done - 1 ? "step" : undefined} className="flex flex-col items-center gap-1.5 text-center">
                    <span className="flex w-full items-center">
                      <span className={`h-0.5 flex-1 ${i === 0 ? "bg-transparent" : i < done ? "bg-[var(--brand-ink)]" : "bg-[var(--border)]"}`} />
                      <span className={`size-3 shrink-0 rounded-full border-2 ${i < done ? "border-[var(--brand-ink)] bg-[var(--brand-ink)]" : "border-[var(--border)] bg-[var(--background)]"}`} />
                      <span className={`h-0.5 flex-1 ${i === RETURN_STEPS.length - 1 ? "bg-transparent" : i < done - 1 ? "bg-[var(--brand-ink)]" : "bg-[var(--border)]"}`} />
                    </span>
                    <span className={`text-[11px] leading-tight sm:text-xs ${i < done ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>{label}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[var(--foreground)]">{ret.status === "rejected" ? "The store declined this return." : "This return was cancelled."}</p>
            )}

            {ret.decisionMessage ? (
              <p className="mt-4 border-t border-[var(--border)] pt-4 text-[var(--foreground)]">
                <span className="font-semibold">Message from the store: </span>
                {ret.decisionMessage}
              </p>
            ) : null}
            {ret.instructions ? (
              <p className="mt-4 border-t border-[var(--border)] pt-4 text-[var(--foreground)]">
                <span className="font-semibold">How to send it back: </span>
                {ret.instructions}
              </p>
            ) : null}
            {ret.refundedAt || ret.refundAmount ? (
              <div className="mt-4 border-t border-[var(--border)] pt-4 text-[var(--foreground)]">
                <span className="font-semibold">Refund: </span>
                {ret.refundAmount ? <Money paise={ret.refundAmount} /> : null}
                {ret.refundMethod ? ` by ${ret.refundMethod.replace(/_/g, " ")}` : ""}
                {ret.refundedAt ? ` on ${when(ret.refundedAt)}` : ""}
              </div>
            ) : null}
          </div>

          <div className={card}>
            <h2 className={heading}>Updates</h2>
            <ol className="ml-1.5 space-y-3 border-l-2 border-[var(--border)] pl-4">
              {[...ret.timeline].reverse().map((e, i) => (
                <li key={`${e.label}-${i}`}>
                  <p className="font-medium text-[var(--foreground)]">{e.label}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{when(e.at)}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="space-y-6 lg:order-1">
          <div className={card}>
            <h2 className={heading}>Items</h2>
            <ul className="divide-y divide-[var(--border-soft)]">
              {ret.items.map((it) => (
                <li key={it.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--foreground)]">{it.title}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {[it.variantTitle && it.variantTitle !== "Default" ? it.variantTitle : null, `Qty ${it.quantity}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums">
                    <Money paise={it.unitPrice * it.quantity} />
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className={card}>
            <h2 className={heading}>Your request</h2>
            <dl className="space-y-2">
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">You asked for</dt>
                <dd className="text-[var(--foreground)]">{(ret.requestedResolution ?? ret.resolution) === "replacement" ? "An exchange" : "A refund"}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">Reason</dt>
                <dd className="text-[var(--foreground)]">{ret.reason}</dd>
              </div>
              {exchange && ret.exchangeRequest ? (
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">Exchange for</dt>
                  <dd className="text-[var(--foreground)]">{ret.exchangeRequest}</dd>
                </div>
              ) : null}
              {ret.customerComment ? (
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">Your note</dt>
                  <dd className="text-[var(--foreground)]">{ret.customerComment}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
