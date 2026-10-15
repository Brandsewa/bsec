import { bundleNode } from "@bs/config/bundle-node";
await bundleNode();
await bundleNode({ entry: "src/demo-cli.ts", outfile: "dist/demo.js" });
// Operator tool to bootstrap the first platform staff member (PLAN §6)
await bundleNode({ entry: "src/create-staff.ts", outfile: "dist/create-staff.js" });

// Operator tool: creates the hidden "Modern Commerce" theme draft (run from the platform container terminal)
await bundleNode({ entry: "src/seed-templates-cli.ts", outfile: "dist/seed-templates.js" });
