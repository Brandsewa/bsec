import React from "react";

export interface ComingSoonScreenProps {
  logoUrl?: string | null | undefined;
  storeName?: string | undefined;
  headline?: string | null | undefined;
  launchAt?: Date | string | null | undefined;
  showCountdown?: boolean | undefined;
  collectEmails?: boolean | undefined;
  socialLinks?: Array<{ platform: string; url: string }> | undefined;
  now?: number | undefined;
}

export function ComingSoonScreen({
  logoUrl,
  storeName = "Store",
  headline,
  launchAt,
  showCountdown = false,
  collectEmails = true,
  socialLinks = [],
  now,
}: ComingSoonScreenProps) {
  const displayHeadline = headline || "Opening Soon";

  let countdownText: string | null = null;
  if (showCountdown && launchAt) {
    const launchDate = new Date(launchAt);
    const currentTime = now ?? launchDate.getTime(); // deterministic during initial render
    const diff = launchDate.getTime() - currentTime;
    if (diff > 0) {
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      countdownText = `${days}d ${hours}h until launch`;
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mx-auto max-w-md space-y-6">
        {logoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={logoUrl}
            alt={storeName}
            className="mx-auto max-h-16 object-contain"
          />
        ) : (
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">
            {storeName}
          </h2>
        )}

        <div className="space-y-2">
          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
            {displayHeadline}
          </h1>
          <p className="text-base text-gray-600">
            We are working hard to bring you something special. Stay tuned!
          </p>
        </div>

        {countdownText && (
          <div className="inline-block rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-800">
            {countdownText}
          </div>
        )}

        {collectEmails && (
          <form
            action="/api/storefront/newsletter/subscribe"
            method="POST"
            className="mx-auto mt-6 flex max-w-sm flex-col gap-2 sm:flex-row"
          >
            <input
              type="email"
              name="email"
              required
              aria-label="Email address"
              placeholder="Enter your email"
              className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm focus:border-black focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Notify Me
            </button>
          </form>
        )}

        {socialLinks.length > 0 && (
          <div className="mt-8 flex justify-center gap-4 text-sm text-gray-500">
            {socialLinks.map((link) => (
              <a
                key={link.platform}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {link.platform}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export interface MaintenanceScreenProps {
  message?: string | undefined;
}

export function MaintenanceScreen({ message }: MaintenanceScreenProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mx-auto max-w-md space-y-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            className="h-6 w-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.072a4.5 4.5 0 003.37-3.37c.116-.58.092-1.192-.072-1.743M9.879 16.121A4.5 4.5 0 103.515 9.757a4.5 4.5 0 006.364 6.364z"
            />
          </svg>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Temporarily down for maintenance. Back soon.
        </h1>
        <p className="text-sm text-gray-600">
          {message || "We are performing scheduled maintenance to improve our service."}
        </p>
      </div>
    </div>
  );
}

export interface PasswordScreenProps {
  storeName?: string | undefined;
  error?: string | undefined;
}

export function PasswordScreen({ storeName = "Store", error }: PasswordScreenProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mx-auto max-w-sm space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          {storeName}
        </h1>
        <p className="text-sm text-gray-600">
          This store is password protected. Enter the store password to enter.
        </p>

        {error && (
          <div className="rounded-md bg-red-50 p-2 text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        <form
          action="/api/storefront/status/verify-password"
          method="POST"
          className="space-y-3"
        >
          <input
            type="password"
            name="password"
            required
            aria-label="Store password"
            placeholder="Store password"
            className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm focus:border-black focus:outline-none"
          />
          <button
            type="submit"
            className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Enter Store
          </button>
        </form>
      </div>
    </div>
  );
}

export function SuspendedScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          This store is temporarily unavailable.
        </h1>
        <p className="text-sm text-gray-600">
          Please check back later or contact support if you are the store owner.
        </p>
      </div>
    </div>
  );
}

export function ProvisioningScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mx-auto max-w-md space-y-4">
        <div className="mx-auto inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-gray-900 border-r-transparent" />
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          Store setup in progress. Please check back shortly.
        </h1>
        <p className="text-sm text-gray-600">
          We are preparing this storefront. This will only take a moment.
        </p>
      </div>
    </div>
  );
}
