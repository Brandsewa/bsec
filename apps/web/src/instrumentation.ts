import type { Instrumentation } from "next";
import { assertProductionEncryptionKeySet } from "@bs/domain";

/** Sentry is optional: without SENTRY_DSN nothing is initialised (local dev, CI). */
export async function register() {
  assertProductionEncryptionKeySet();
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.APP_ENV ?? "development",
      release: process.env.APP_VERSION,
      tracesSampleRate: 0.05,
    });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
