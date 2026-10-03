#!/usr/bin/env node
import { execSync, spawnSync } from "node:child_process";
import net from "node:net";

const start = Date.now();
const args = process.argv.slice(2);
const down = args.includes("--down");

const HOST = "localhost";
const PORT = 55432;
const TEST_PG_ADMIN_URL = `postgres://postgres:postgres@${HOST}:${PORT}/postgres`;

function checkPort(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isResolved = false;

    const onFinish = (status) => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve(status);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => onFinish(true));
    socket.once("timeout", () => onFinish(false));
    socket.once("error", () => onFinish(false));

    socket.connect(port, host);
  });
}

async function waitForPort(host, port, maxWaitMs = 15000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if (await checkPort(host, port, 1000)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (down) {
  console.log("Tearing down test database container...");
  execSync("docker compose -f docker-compose.test-db.yml down", { stdio: "inherit" });
  process.exit(0);
}

// 1. Ensure docker compose test-db is running
const isReady = await checkPort(HOST, PORT, 500);

if (!isReady) {
  console.log("Starting test postgres container (docker-compose.test-db.yml)...");
  try {
    execSync("docker compose -f docker-compose.test-db.yml up -d", { stdio: "inherit" });
  } catch (_err) {
    console.error("\nError: Failed to start docker-compose.test-db.yml. Is Docker daemon running?");
    process.exit(1);
  }

  const ready = await waitForPort(HOST, PORT, 15000);
  if (!ready) {
    console.error(`\nError: Postgres container on port ${PORT} did not become ready within 15s.`);
    process.exit(1);
  }
}

console.log(`[test:heavy:local] Using test database: ${TEST_PG_ADMIN_URL}`);

// 2. Run domain heavy tests (and any db heavy tests if applicable)
const env = {
  ...process.env,
  TEST_PG_ADMIN_URL,
};

const domainRes = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["--filter", "@bs/domain", "test:heavy", ...args],
  {
    stdio: "inherit",
    env,
  },
);

const elapsedSec = ((Date.now() - start) / 1000).toFixed(2);
console.log(`\n[test:heavy:local] Finished in ${elapsedSec}s with exit code ${domainRes.status ?? 0}`);

process.exit(domainRes.status ?? 0);
