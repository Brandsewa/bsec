import { defineBsConfig } from "@bs/config/eslint";

// The API code itself must not touch the database (PLAN §3). Its integration tests do: they seed and inspect a real test database.
export default [
  ...defineBsConfig(),
  { files: ["test/**"], rules: { "no-restricted-imports": "off" } },
];
