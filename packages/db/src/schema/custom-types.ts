import { customType } from "drizzle-orm/pg-core";

/**
 * Case-insensitive text type (PostgreSQL extension citext created in 0001_extensions.sql).
 */
export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});
