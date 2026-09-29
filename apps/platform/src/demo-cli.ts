/**
 * Operator tool for the Demo Store, run from the platform container terminal:
 *   OWNER_EMAIL=you@example.com node dist/demo.js seed
 *   node dist/demo.js remove
 * It only ever touches the store with slug "demo-store" and never contacts any external provider.
 */
import { createRuntime, DEMO_SLUG, removeDemoStore, seedDemoStore } from "@bs/domain";

const command = process.argv[2];
const url = process.env.DATABASE_URL_PLATFORM;
if (!url) throw new Error("Missing env DATABASE_URL_PLATFORM");

const rt = createRuntime({ service: "platform", databaseUrl: url, poolMax: 2 });
try {
  if (command === "seed") {
    const ownerEmail = process.env.OWNER_EMAIL;
    if (!ownerEmail) throw new Error("Set OWNER_EMAIL to the login that should own the demo store");
    const res = await seedDemoStore(rt, { ownerEmail });
    console.log(
      res.alreadySeeded
        ? `Demo store '${res.slug}' already has data (${res.products} products). Nothing changed.`
        : `Demo store '${res.slug}' created: ${res.products} products, ${res.customers} customers, ${res.orders} orders, ${res.discounts} discounts.`,
    );
    console.log("Sign in to the admin and switch store (top right) to 'Demo Store'.");
  } else if (command === "remove") {
    const res = await removeDemoStore(rt, DEMO_SLUG);
    console.log(res.removed ? `Demo store removed. Rows deleted: ${JSON.stringify(res.deleted)}` : "No demo store found. Nothing to remove.");
  } else {
    console.log("Usage: node dist/demo.js seed | remove");
    process.exitCode = 1;
  }
} finally {
  await rt.close();
}
