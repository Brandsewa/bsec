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
        "@typescript-eslint/consistent-type-imports": "error",
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        ...(allowDb ? {} : { "no-restricted-imports": ["error", DB_BAN] }),
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
