import nextPlugin from "@next/eslint-plugin-next";
import { defineBsConfig } from "@bs/config/eslint";

export default [
  ...defineBsConfig({ react: true, routes: "next" }),
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    settings: { next: { rootDir: import.meta.dirname } },
    rules: { ...nextPlugin.configs.recommended.rules, ...nextPlugin.configs["core-web-vitals"].rules },
  },
];
