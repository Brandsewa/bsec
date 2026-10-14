import { build } from "esbuild";

/**
 * Bundles a Node service (platform, worker) into one ESM file: dist/main.js.
 * Everything is inlined, so the runtime image needs no node_modules (except native modules listed as external).
 */
export async function bundleNode({ entry = "src/main.ts", outfile = "dist/main.js" } = {}) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    sourcemap: true,
    legalComments: "none",
    // pg's optional native binding is never installed. sharp is a native module: it cannot be inlined, so the
    // worker image installs it next to the bundle (infra/docker/worker.Dockerfile) and loads it lazily.
    external: ["pg-native", "sharp"],
    // CJS dependencies inside an ESM bundle still call require()/__dirname.
    banner: {
      js: [
        'import { createRequire as __bsCreateRequire } from "node:module";',
        'import { fileURLToPath as __bsFileURLToPath } from "node:url";',
        'import { dirname as __bsDirname } from "node:path";',
        "const require = __bsCreateRequire(import.meta.url);",
        "const __filename = __bsFileURLToPath(import.meta.url);",
        "const __dirname = __bsDirname(__filename);",
      ].join("\n"),
    },
  });
}
