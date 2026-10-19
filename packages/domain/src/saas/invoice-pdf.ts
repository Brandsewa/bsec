import { and, eq } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { schema, withTenant } from "@bs/db";
import { SaasNotConfiguredError, saasDb, type Runtime } from "../runtime.ts";
import { loadInvoiceProfile, type InvoiceProfile } from "../platform/billing-settings.ts";

/**
 * GST tax invoice PDF for a platform plan payment (billing B6). Rendered on demand from the invoice row, so nothing is
 * stored and the document always matches the database. The plan price is quoted inclusive of tax: the taxable value is the
 * amount less the tax already recorded on the invoice.
 */

export interface InvoicePdfData {
  number: string;
  issuedAt: Date;
  paidAt: Date | null;
  amountPaise: number;
  taxPaise: number;
  planName: string;
  interval: string;
  seller: InvoiceProfile;
  buyer: { name: string; address: string | null; state: string | null; gstin: string | null; email: string | null };
}

const DEFAULT_PROFILE: InvoiceProfile = { legalName: null, address: null, state: null, gstin: null, sac: null, gstRateBps: 1800 };

/** Rupees with Indian digit grouping. Standard PDF fonts have no rupee sign, so the document says "Rs.". */
export function pdfMoney(paise: number): string {
  const rupees = (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Rs. ${rupees}`;
}

/** Same state on both sides means CGST plus SGST; otherwise (or when a state is unknown) IGST. */
export function taxSplit(taxPaise: number, sellerState: string | null, buyerState: string | null): Array<{ label: string; paise: number }> {
  const same = Boolean(sellerState && buyerState && sellerState.trim().toLowerCase() === buyerState.trim().toLowerCase());
  if (!same) return [{ label: "IGST", paise: taxPaise }];
  const half = Math.floor(taxPaise / 2);
  return [
    { label: "CGST", paise: half },
    { label: "SGST", paise: taxPaise - half },
  ];
}

export async function loadInvoicePdfData(rt: Runtime, tenantId: string, invoiceId: string): Promise<InvoicePdfData | null> {
  const db = rt._db.db;
  const [inv] = await db
    .select()
    .from(schema.platformInvoices)
    .where(and(eq(schema.platformInvoices.id, invoiceId), eq(schema.platformInvoices.tenantId, tenantId)))
    .limit(1);
  if (!inv) return null;

  let planName = "Subscription";
  let interval = "monthly";
  if (inv.subscriptionId) {
    const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, inv.subscriptionId)).limit(1);
    if (sub) {
      interval = sub.interval;
      if (sub.planId) {
        const [plan] = await db.select({ name: schema.plans.name }).from(schema.plans).where(eq(schema.plans.id, sub.planId)).limit(1);
        if (plan) planName = plan.name;
      }
    }
  }

  let seller = DEFAULT_PROFILE;
  try {
    seller = await loadInvoiceProfile(saasDb(rt));
  } catch (e) {
    if (!(e instanceof SaasNotConfiguredError)) throw e;
  }

  const buyer = await withTenant(db, tenantId, async (tx) => {
    const [s] = await tx.select().from(schema.storeSettings).where(eq(schema.storeSettings.tenantId, tenantId)).limit(1);
    const address = (s?.address ?? null) as { line1?: string; city?: string; state?: string; pincode?: string } | null;
    const cfg = (s?.checkout ?? null) as { tax?: { gstin?: string | null } } | null;
    return {
      name: s?.legalName || s?.storeName || "Store",
      address: address ? [address.line1, address.city, address.pincode].filter(Boolean).join(", ") || null : null,
      state: address?.state ?? null,
      gstin: cfg?.tax?.gstin ?? null,
      email: s?.supportEmail ? String(s.supportEmail) : null,
    };
  });

  return { number: inv.number, issuedAt: inv.issuedAt, paidAt: inv.paidAt, amountPaise: inv.amountPaise, taxPaise: inv.taxPaise, planName, interval, seller, buyer };
}

export function renderPlatformInvoicePdf(d: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Invoice ${d.number}`, Author: d.seller.legalName ?? "Brand Sewa" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const date = (x: Date) => x.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
    const left = 48;
    const right = 547;

    doc.font("Helvetica-Bold").fontSize(18).text("TAX INVOICE", left, 48);
    doc.font("Helvetica").fontSize(9).fillColor("#555555").text(d.paidAt ? "Paid" : "Issued", right - 100, 52, { width: 100, align: "right" });
    doc.fillColor("#000000");

    // Seller and invoice details
    doc.font("Helvetica-Bold").fontSize(11).text(d.seller.legalName ?? "Brand Sewa", left, 90);
    doc.font("Helvetica").fontSize(9);
    if (d.seller.address) doc.text(d.seller.address, { width: 260 });
    if (d.seller.gstin) doc.text(`GSTIN: ${d.seller.gstin}`);
    if (d.seller.state) doc.text(`State: ${d.seller.state}`);

    doc.font("Helvetica").fontSize(9).text(`Invoice no: ${d.number}`, 330, 90, { width: right - 330, align: "right" });
    doc.text(`Invoice date: ${date(d.issuedAt)}`, 330, undefined, { width: right - 330, align: "right" });
    if (d.paidAt) doc.text(`Paid on: ${date(d.paidAt)}`, 330, undefined, { width: right - 330, align: "right" });

    // Buyer
    doc.moveTo(left, 175).lineTo(right, 175).strokeColor("#cccccc").stroke();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#555555").text("BILLED TO", left, 185);
    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(11).text(d.buyer.name, left, 200);
    doc.font("Helvetica").fontSize(9);
    if (d.buyer.address) doc.text(d.buyer.address, { width: 300 });
    if (d.buyer.state) doc.text(`State (place of supply): ${d.buyer.state}`);
    if (d.buyer.gstin) doc.text(`GSTIN: ${d.buyer.gstin}`);
    if (d.buyer.email) doc.text(d.buyer.email);

    // Lines
    const top = 290;
    doc.rect(left, top, right - left, 22).fill("#f2f4f3");
    doc.fillColor("#000000").font("Helvetica-Bold").fontSize(9);
    doc.text("Description", left + 8, top + 7);
    doc.text("SAC", 330, top + 7, { width: 60 });
    doc.text("Amount", 430, top + 7, { width: right - 438, align: "right" });

    const taxable = d.amountPaise - d.taxPaise;
    doc.font("Helvetica").fontSize(10);
    doc.text(`${d.planName} plan (${d.interval})`, left + 8, top + 34, { width: 270 });
    doc.text(d.seller.sac ?? "-", 330, top + 34, { width: 60 });
    doc.text(pdfMoney(taxable), 430, top + 34, { width: right - 438, align: "right" });

    // Totals
    let y = top + 80;
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).text(label, 330, y, { width: 100 });
      doc.text(value, 430, y, { width: right - 438, align: "right" });
      y += 18;
    };
    row("Taxable value", pdfMoney(taxable));
    for (const t of taxSplit(d.taxPaise, d.seller.state, d.buyer.state)) {
      const rate = d.seller.gstRateBps / (taxSplit(d.taxPaise, d.seller.state, d.buyer.state).length === 2 ? 200 : 100);
      row(`${t.label} (${rate}%)`, pdfMoney(t.paise));
    }
    doc.moveTo(330, y).lineTo(right, y).strokeColor("#cccccc").stroke();
    y += 6;
    row("Total", pdfMoney(d.amountPaise), true);

    doc.font("Helvetica").fontSize(8).fillColor("#666666");
    doc.text("The plan price includes GST. This is a computer generated invoice and needs no signature.", left, 760, { width: right - left });
    if (!d.seller.gstin) doc.text("Seller GST details are not configured yet.", left, 774, { width: right - left });

    doc.end();
  });
}
