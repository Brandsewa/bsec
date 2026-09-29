/**
 * Operator tool: create/reset the store owner login. Run from the worker container's terminal:
 *   OWNER_EMAIL=you@example.com OWNER_NAME="Your Name" STORE_SLUG=<slug> node dist/create-owner.js
 * The password is read from an interactive hidden prompt (or OWNER_PASSWORD when there is no TTY)
 * and is never printed or logged.
 */
import { createInterface } from "node:readline";
import { createRuntime, createStoreOwner } from "@bs/domain";

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const w = rl as unknown as { _writeToOutput: (s: string) => void };
    process.stdout.write(question);
    w._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const url = process.env.DATABASE_URL_RW;
if (!url) throw new Error("Missing env DATABASE_URL_RW");
const email = process.env.OWNER_EMAIL;
const slug = process.env.STORE_SLUG;
if (!email || !slug) throw new Error("Set OWNER_EMAIL and STORE_SLUG");

let password = process.env.OWNER_PASSWORD ?? "";
if (!password) {
  if (!process.stdin.isTTY) throw new Error("No TTY: set OWNER_PASSWORD or run in an interactive terminal");
  password = await promptHidden("New password (hidden, min 10 chars): ");
  const again = await promptHidden("Repeat password: ");
  if (password !== again) throw new Error("Passwords do not match");
}

const rt = createRuntime({ service: "worker", databaseUrl: url, poolMax: 1 });
try {
  const res = await createStoreOwner(rt._db.db, {
    email,
    name: process.env.OWNER_NAME ?? email,
    password,
    tenantSlug: slug,
  });
  console.log(res.createdUser ? `Owner created for store '${slug}'.` : `Owner password updated for store '${slug}'.`);
} finally {
  await rt._db.close();
}
