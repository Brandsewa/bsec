import { NextResponse } from "next/server";
import { z } from "zod";
import { checkStorefrontRateLimit, getClientIp, submitContactForm } from "@bs/domain";
import { errorResponse, resolveStore, sameOrigin } from "@/server/customer-session.ts";

const Body = z.object({
  formName: z.string().max(80).optional(),
  recipientEmail: z.string().max(254).optional(),
  name: z.string().min(1).max(120),
  email: z.string().min(3).max(254),
  phone: z.string().max(40).nullish(),
  choice: z.string().max(120).nullish(),
  message: z.string().max(4000).nullish(),
  honeypot: z.string().max(200).nullish(),
});

/** A storefront contact-form submission, saved to the store's admin inbox. */
export async function POST(req: Request) {
  try {
    if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const store = await resolveStore(req);
    if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });
    await checkStorefrontRateLimit(store.rt._db.db, store.tenantId);

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Please fill in your name and email." }, { status: 400 });
    const d = parsed.data;
    await submitContactForm(store.rt, store.tenantId, {
      formName: d.formName,
      recipientEmail: d.recipientEmail,
      name: d.name,
      email: d.email,
      phone: d.phone ?? undefined,
      choice: d.choice ?? undefined,
      message: d.message ?? undefined,
      honeypot: d.honeypot ?? undefined,
      ip: getClientIp(req.headers),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err, "Could not send your message right now");
  }
}
