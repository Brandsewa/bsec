import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { writePlatformAudit } from "../platform-services.ts";
import { validateTemplatePages } from "./templates.ts";
import { MODERN_TEMPLATE_NAME, MODERN_TEMPLATE_PAGES, MODERN_TEMPLATE_TOKENS } from "./commerce-templates.ts";

export const MODERN_TEMPLATE_CODE = "modern-commerce";

/**
 * Operator tool: creates (or refreshes the draft of) the "Modern Commerce" theme. It never publishes
 * and never touches stores: the theme stays hidden (is_active=false) until staff publish it in Super
 * Admin. Audited like any platform change, attributed to the staff member whose email is given.
 */
export async function seedModernTemplate(rt: Runtime, input: { staffEmail: string }): Promise<{ code: string; created: boolean }> {
  const db = rt._db.db;
  const [actor] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.platformStaff, eq(schema.platformStaff.userId, schema.users.id))
    .where(eq(schema.users.email, input.staffEmail))
    .limit(1);
  if (!actor) throw new Error(`No platform staff account for ${input.staffEmail}; create it with create-staff first`);

  const pages = validateTemplatePages(MODERN_TEMPLATE_PAGES);
  const tokens = structuredClone(MODERN_TEMPLATE_TOKENS) as Record<string, unknown>;

  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: schema.themeTemplates.id }).from(schema.themeTemplates).where(eq(schema.themeTemplates.code, MODERN_TEMPLATE_CODE)).limit(1);
    if (existing) {
      await tx.update(schema.themeTemplates).set({ draftPages: pages, draftTokens: tokens, updatedAt: new Date() }).where(eq(schema.themeTemplates.id, existing.id));
    } else {
      await tx.insert(schema.themeTemplates).values({
        code: MODERN_TEMPLATE_CODE,
        name: MODERN_TEMPLATE_NAME,
        industry: "general",
        description: "Conversion-focused collection, product and cart pages with trust signals and recommendations.",
        features: ["Sticky buy box", "Trust signals", "Cart recommendations"],
        defaultTokens: tokens,
        defaultPages: {},
        draftPages: pages,
        draftTokens: tokens,
        isActive: false,
      });
    }
    await writePlatformAudit(tx, actor.id, existing ? "theme_template.draft_save" : "theme_template.create", "theme_template", MODERN_TEMPLATE_CODE, null, { seeded: true, pages: Object.keys(pages) });
    return { code: MODERN_TEMPLATE_CODE, created: !existing };
  });
}
