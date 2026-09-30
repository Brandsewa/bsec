import { ensureTemplate } from "./shared-pg.ts";

export default async function setup() {
  await ensureTemplate();
}
