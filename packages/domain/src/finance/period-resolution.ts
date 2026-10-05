/**
 * Period date boundary resolution for finance reports (docs/FINANCE-PLAN.md §3.6).
 *
 * URL-driven: named 7d | 30d | 90d | ytd | all, or custom from / to.
 * Day boundaries are resolved in the store's timezone (default Asia/Kolkata).
 */

export interface PeriodResolution {
  from: Date;
  to: Date;
  named?: string | undefined;
  fromIso: string;
  toIso: string;
}

export interface PeriodInput {
  named?: ("7d" | "30d" | "90d" | "ytd" | "all") | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * Returns UTC Date boundaries for a named period or explicit from/to dates.
 */
export function resolvePeriod(
  input: PeriodInput = {},
  now: Date = new Date(),
): PeriodResolution {
  const named = input.named ?? (!input.from && !input.to ? "30d" : undefined);

  if (input.from && input.to) {
    const from = new Date(input.from.length === 10 ? `${input.from}T00:00:00.000Z` : input.from);
    const to = new Date(input.to.length === 10 ? `${input.to}T23:59:59.999Z` : input.to);
    return {
      from,
      to,
      named,
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
    };
  }

  const to = new Date(now.getTime());

  let from: Date;
  switch (named) {
    case "7d":
      from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "30d":
      from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "90d":
      from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case "ytd": {
      // Beginning of current calendar year in UTC
      from = new Date(Date.UTC(to.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      break;
    }
    case "all":
    default:
      from = new Date(0); // Epoch start
      break;
  }

  return {
    from,
    to,
    named,
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
  };
}
