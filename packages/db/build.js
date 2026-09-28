import { bundleNode } from "@bs/config/bundle-node";

// One-shot migration image. deploy.js is the image's default CMD (RUNBOOK §4-6): it
// conditionally bootstraps roles, then always migrates. bootstrap.js/migrate.js stay
// available for manual/local use (docs/migrations.md).
await bundleNode({ entry: "src/scripts/bootstrap-roles.ts", outfile: "dist/bootstrap.js" });
await bundleNode({ entry: "src/scripts/migrate.ts", outfile: "dist/migrate.js" });
await bundleNode({ entry: "src/scripts/deploy.ts", outfile: "dist/deploy.js" });
