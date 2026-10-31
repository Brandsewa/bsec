import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { bsPlugin } from "./rules/index.js";

// PLAN §3: only packages/db and packages/domain may touch the database.
const DB_BAN = {
  paths: [
    { name: "@bs/db", message: "Only packages/db and packages/domain may import @bs/db. Call a domain service." },
  ],
  patterns: [
    { group: ["@bs/db/*"], message: "Only packages/db and packages/domain may import @bs/db." },
    { group: ["drizzle-orm", "drizzle-orm/*", "pg", "postgres"], message: "Database drivers belong in packages/db." },
  ],
};

// ADR-041: Lucide is imported by name so the bundler keeps only the icons a file uses. The catalog helpers pull
// in all ~1,900 icons; picker and storefront rendering go through @bs/icons instead.
const ICON_BAN = {
  paths: [
    {
      name: "lucide-react",
      importNames: ["icons", "DynamicIcon", "dynamicIconImports"],
      message: "Import each Lucide icon by name (import { Truck } from \"lucide-react\"). For icons chosen by name at runtime use @bs/icons.",
    },
  ],
  patterns: [{ group: ["lucide-react/dynamic", "lucide-react/dynamicIconImports", "lucide-react/dist/*"], message: "Use named imports from lucide-react, or @bs/icons for runtime names." }],
};
const mergeBans = (...bans) => ({ paths: bans.flatMap((b) => b.paths), patterns: bans.flatMap((b) => b.patterns) });

/**
 * @param {{ allowDb?: boolean, react?: boolean, routes?: "tanstack" | "next", ignores?: string[] }} [opts]
 */
export function defineBsConfig(opts = {}) {
  const { allowDb = false, react = false, routes, ignores = [] } = opts;
  return tseslint.config(
    { ignores: ["dist/**", ".next/**", "**/*.gen.ts", "next-env.d.ts", "coverage/**", ...ignores] },
    js.configs.recommended,
    ...tseslint.configs.strict,
    {
      languageOptions: { globals: { ...globals.node, ...(react ? globals.browser : {}) } },
      plugins: { bs: bsPlugin },
      rules: {
        "bs/tenant-cache-tag": "error",
        "bs/no-service-call-in-tx": "error",
        "bs/design-system-guards": "error",
        "@typescript-eslint/consistent-type-imports": "error",
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        "no-restricted-imports": ["error", allowDb ? ICON_BAN : mergeBans(DB_BAN, ICON_BAN)],
      },
    },
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "test/**"],
      rules: { "@typescript-eslint/no-non-null-assertion": "off" },
    },
    ...(react
      ? [
          {
            files: ["**/*.ts", "**/*.tsx"],
            plugins: { "react-hooks": reactHooks },
            rules: reactHooks.configs.recommended.rules,
          },
        ]
      : []),
    ...(routes ? [{ files: ["**/*.tsx"], rules: { "bs/route-pending": ["error", { mode: routes }] } }] : []),
  );
}
export default defineBsConfig;
