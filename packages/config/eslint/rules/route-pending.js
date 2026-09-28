import fs from "node:fs";
import path from "node:path";

/**
 * Skeleton loading on every route (PLAN §12).
 *  - tanstack (admin): every file under src/routes must declare `pendingComponent`.
 *    Files or folders prefixed with "-" are colocated helpers and are skipped.
 *  - next (web): every app/**\/page.tsx must have a loading.tsx in the same folder.
 */
/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "Require a skeleton (pendingComponent / loading.tsx) for every route" },
    messages: {
      missingPending: "Route files must set pendingComponent (use a skeleton from @bs/ui).",
      missingLoading: "page.tsx needs a sibling loading.tsx with a matching skeleton.",
    },
    schema: [
      {
        type: "object",
        properties: { mode: { enum: ["tanstack", "next"] } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const mode = context.options[0]?.mode ?? "tanstack";
    const file = context.filename.replaceAll("\\", "/");

    if (mode === "next") {
      if (!/\/app\/(?:.*\/)?page\.tsx$/.test(file)) return {};
      return {
        Program(node) {
          const loading = path.join(path.dirname(context.filename), "loading.tsx");
          if (!fs.existsSync(loading)) context.report({ node, messageId: "missingLoading" });
        },
      };
    }

    const idx = file.indexOf("/src/routes/");
    if (idx === -1 || !file.endsWith(".tsx")) return {};
    const rel = file.slice(idx + "/src/routes/".length);
    if (rel.split("/").some((seg) => seg.startsWith("-"))) return {};

    let found = false;
    return {
      Property(node) {
        if (node.key.type === "Identifier" && node.key.name === "pendingComponent") found = true;
      },
      "Program:exit"(node) {
        if (!found) context.report({ node, messageId: "missingPending" });
      },
    };
  },
};
