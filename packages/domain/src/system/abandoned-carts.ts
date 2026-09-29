import { and, eq, lt, sql } from "drizzle-orm";
import { type Db, withTenant, schema, QUEUE_NAMES } from "@bs/db";
import { sendTransactionalEmail } from "./email.ts";

export interface SweepAbandonedCartsResult {
  abandonedCount: number;
  emailsSentCount: number;
}

/**
 * Sweeps inactive shopping carts and transitions them to 'abandoned' status (PLAN §5.5, §11 domain events).
 * Any active cart with last_activity_at older than inactiveThresholdMinutes (default: 60 mins)
 * is marked 'abandoned'. If customer email is present, sends recovery email and enqueues cart.abandoned.
 */
export async function sweepAbandonedCarts(
  db: Db,
  tenantId: string,
  opts: {
    inactiveThresholdMinutes?: number;
    sendRecoveryEmail?: boolean;
    jobs?: { send: (queue: string, data: object) => Promise<unknown> } | undefined;
  } = {},
): Promise<SweepAbandonedCartsResult> {
  const thresholdMinutes = opts.inactiveThresholdMinutes ?? 60;
  const thresholdDate = new Date(Date.now() - thresholdMinutes * 60 * 1000);

  return await withTenant(db, tenantId, async (tx) => {
    // Select carts that are 'active' but last_activity_at < thresholdDate
    const abandonedCarts = await tx
      .select({
        id: schema.carts.id,
        token: schema.carts.token,
        email: schema.carts.email,
        phone: schema.carts.phone,
        lastActivityAt: schema.carts.lastActivityAt,
        recoverySentAt: schema.carts.recoverySentAt,
      })
      .from(schema.carts)
      .where(
        and(
          eq(schema.carts.status, "active"),
          lt(schema.carts.lastActivityAt, thresholdDate),
        ),
      );

    let emailsSentCount = 0;

    for (const cart of abandonedCarts) {
      // Transition cart status to 'abandoned'
      await tx
        .update(schema.carts)
        .set({
          status: "abandoned",
        })
        .where(eq(schema.carts.id, cart.id));

      // Emit domain event cart.abandoned if jobs provider available
      if (opts.jobs) {
        await opts.jobs.send(QUEUE_NAMES.CART_ABANDONED, {
          tenantId,
          cartId: cart.id,
          token: cart.token,
          email: cart.email,
        });
      }

      // If cart has customer email and hasn't had recovery email sent yet
      if (cart.email && !cart.recoverySentAt && opts.sendRecoveryEmail !== false) {
        const emailResult = await sendTransactionalEmail(db, {
          tenantId,
          template: "abandoned_cart_recovery",
          toEmail: cart.email,
          subject: "Did you leave something behind?",
          data: {
            cartToken: cart.token,
          },
          eventRef: `cart_${cart.id}`,
        });

        if (emailResult.status === "sent") {
          await tx
            .update(schema.carts)
            .set({
              recoverySentAt: sql`now()`,
            })
            .where(eq(schema.carts.id, cart.id));

          emailsSentCount++;
        }
      }
    }

    return {
      abandonedCount: abandonedCarts.length,
      emailsSentCount,
    };
  });
}
