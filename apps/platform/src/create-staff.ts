/**
 * Operator tool: create the bootstrap platform staff login, or reset its authenticator (PLAN §6).
 * Run from the platform container's terminal:
 *   STAFF_EMAIL=owner@example.com STAFF_NAME="Platform Owner" node dist/create-staff.js
 *   STAFF_EMAIL=... STAFF_RESET_MFA=1 node dist/create-staff.js      (lost phone: they set up a new authenticator)
 *   STAFF_EMAIL=... STAFF_RESET_PASSWORD=1 node dist/create-staff.js (forgotten password: asks for the new one, ends their sessions)
 * A password is asked for (hidden prompt, or STAFF_PASSWORD when there is no TTY) only when the account is new. An existing
 * account keeps its password. The password is never printed or logged. MFA enrolment is required at first login.
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

const email = process.env.STAFF_EMAIL;
if (!email) throw new Error("Missing env STAFF_EMAIL");
const name = process.env.STAFF_NAME ?? "Platform Owner";
const role = (process.env.STAFF_ROLE as "platform_owner" | "platform_admin" | "platform_support") ?? "platform_owner";
const resetMfa = process.env.STAFF_RESET_MFA === "1";
const resetPassword = process.env.STAFF_RESET_PASSWORD === "1";

const rt = createRuntime({ service: "platform", databaseUrl: url, poolMax: 1 });
try {
  let password = process.env.STAFF_PASSWORD || undefined;
  const attempt = () => createPlatformStaffMember(rt._db.db, { email, name, role, resetMfa, resetPassword, ...(password ? { password } : {}) });

  let res;
  try {
    res = await attempt();
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("Password required")) throw err;
    if (!process.stdin.isTTY) throw new Error("This account needs a password: set STAFF_PASSWORD or run in an interactive terminal", { cause: err });
    password = await promptHidden("New platform staff password (hidden, min 10 chars): ");
    const again = await promptHidden("Repeat password: ");
    if (password !== again) throw new Error("Passwords do not match", { cause: err });
    res = await attempt();
  }

  console.log(
    res.createdUser
      ? `Platform staff '${email}' created with role '${role}'. They set up an authenticator at first sign-in.`
      : `'${email}' is now platform staff with role '${role}'. Their password was not changed.`,
  );
  if (resetMfa) console.log("Authenticator removed and all sessions ended: they set up a new authenticator at next sign-in.");
} finally {
  await rt._db.close();
}
