/**
 * Operator tool: create or reset the bootstrap platform staff login (PLAN §6).
 * Run from the platform container's terminal:
 *   STAFF_EMAIL=brandsewaofficial@gmail.com STAFF_NAME="Platform Owner" node dist/create-staff.js
 * The password is read from an interactive hidden prompt (or STAFF_PASSWORD when there is no TTY)
 * and is never printed or logged. MFA enrolment is required upon first login.
 */
import { createInterface } from "node:readline";
import { createRuntime, createPlatformStaffMember } from "@bs/domain";

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

const url = process.env.DATABASE_URL_PLATFORM;
if (!url) throw new Error("Missing env DATABASE_URL_PLATFORM");

const email = process.env.STAFF_EMAIL ?? "brandsewaofficial@gmail.com";
const name = process.env.STAFF_NAME ?? "Platform Owner";
const role = (process.env.STAFF_ROLE as "platform_owner" | "platform_admin" | "platform_support") ?? "platform_owner";

let password = process.env.STAFF_PASSWORD ?? "";
if (!password) {
  if (!process.stdin.isTTY) throw new Error("No TTY: set STAFF_PASSWORD or run in an interactive terminal");
  password = await promptHidden("New platform staff password (hidden, min 10 chars): ");
  const again = await promptHidden("Repeat password: ");
  if (password !== again) throw new Error("Passwords do not match");
}

const rt = createRuntime({ service: "platform", databaseUrl: url, poolMax: 1 });
try {
  const res = await createPlatformStaffMember(rt._db.db, {
    email,
    name,
    password,
    role,
  });
  console.log(
    res.createdUser
      ? `Platform staff '${email}' created with role '${role}'. MFA enrolment required at first login.`
      : `Platform staff '${email}' password updated. MFA enrolment verified at login.`,
  );
} finally {
  await rt._db.close();
}
