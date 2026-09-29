import { bundleNode } from "@bs/config/bundle-node";
await bundleNode();
// Operator tool, run manually from the container terminal (not started by default).
await bundleNode({ entry: "src/create-owner.ts", outfile: "dist/create-owner.js" });
