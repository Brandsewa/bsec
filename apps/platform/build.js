import { bundleNode } from "@bs/config/bundle-node";
await bundleNode();
// Operator tool for the demo store, run manually from the container terminal (not started by default).
await bundleNode({ entry: "src/demo-cli.ts", outfile: "dist/demo.js" });
