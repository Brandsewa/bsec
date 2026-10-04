/**
 * Operator tool: seeds the unpublished "Modern Commerce" theme draft (collection, product and cart
 * layouts) so staff can refine it in Super Admin. Safe to re-run: it only refreshes the draft.
 *   STAFF_EMAIL=you@example.com tsx src/seed-templates-cli.ts
 */
import { createRuntime, seedModernTemplate } from "@bs/domain";

const url = process.env.DATABASE_URL_PLATFORM;
if (!url) throw new Error("Missing env DATABASE_URL_PLATFORM");
const staffEmail = process.env.STAFF_EMAIL;
if (!staffEmail) throw new Error("Set STAFF_EMAIL to a platform staff login");

const rt = createRuntime({ service: "platform", databaseUrl: url, poolMax: 1 });
try {
  const res = await seedModernTemplate(rt, { staffEmail });
  console.log(`${res.created ? "Created" : "Refreshed"} draft theme '${res.code}'. Open it in Super Admin > Themes to edit and publish.`);
} finally {
  await rt._db.close();
}
