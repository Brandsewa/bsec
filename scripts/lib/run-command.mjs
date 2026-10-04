import { spawnSync } from "node:child_process";

/**
 * Runs a command with inherited output and returns its exit code, never a false success.
 *
 * On Windows `pnpm` and `npx` are .cmd files; Node 20.12+ refuses to spawn a .cmd without a shell (EINVAL), which
 * leaves `status` null. A script that did `status ?? 0` then reported success for tests that never ran. Here a command
 * that could not start, or was killed by a signal, is a failure (1).
 */
export function runCommand(command, args, options = {}) {
  const res = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (res.error) {
    console.error(`[run] could not run "${command} ${args.join(" ")}": ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
}
