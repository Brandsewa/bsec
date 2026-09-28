import { bundleNode } from "@bs/config/bundle-node";

// One-shot migration image: bootstrap (superuser, once per env) + migrate (app_owner, every deploy).
await bundleNode({ entry: "src/scripts/bootstrap-roles.ts", outfile: "dist/bootstrap.js" });
await bundleNode({ entry: "src/scripts/migrate.ts", outfile: "dist/migrate.js" });
