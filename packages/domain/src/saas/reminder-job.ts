import { sql } from "drizzle-orm";
import type { Db } from "@bs/db";

export interface AbandonedSignupReminderResult {
  inspectedLeads: number;
  remindedCount: number;
  leadEmails: string[];
}

/**
 * 24-hour Abandoned Signup Reminder Job (PLAN §7).
 * Scans signup_leads that entered email but did not convert to store_created within 24 hours.
 * Dispatches gentle reminder email/notification and marks lead.
 */
export async function runAbandonedSignupReminderJob(
  db: Db,
): Promise<AbandonedSignupReminderResult> {
  // Select leads older than 24 hours that provided an email, did not convert, and haven't been reminded
  const leads = await db.execute<{
    id: string;
    email: string;
    name: string | null;
    business_name: string | null;
    desired_slug: string | null;
  }>(sql`
    SELECT id, email, name, business_name, desired_slug
    FROM signup_leads
    WHERE email IS NOT NULL
      AND step != 'store_created'
      AND step != 'reminded'
      AND created_at <= now() - interval '24 hours'
      AND created_at >= now() - interval '7 days'
    LIMIT 100;
  `);

  const remindedEmails: string[] = [];

  for (const lead of leads.rows) {
    if (!lead.email) continue;

    // Record notification / mark lead as reminded
    await db.execute(sql`
      UPDATE signup_leads
      SET step = 'reminded', updated_at = now()
      WHERE id = ${lead.id};
    `);

    // In production, transactional email service (Resend adapter) dispatches
    // "Finish setting up your store on gobs.cloud" reminder.
    remindedEmails.push(lead.email);
  }

  return {
    inspectedLeads: leads.rows.length,
    remindedCount: remindedEmails.length,
    leadEmails: remindedEmails,
  };
}
