import type { Instrumentation } from "next";

/** Sentry is optional: without SENTRY_DSN nothing is initialised (local dev, CI). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Dynamic import keeps @bs/domain (node:crypto) out of the Edge instrumentation bundle.
    const { warnIfEncryptionKeyMissing } = await import("@bs/domain");
    warnIfEncryptionKeyMissing();
  }
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
