/**
 * What a merchant may be told when a media request fails.
 *
 * Storage and database failures carry internals (file system paths, bucket and endpoint names, connection details,
 * stack frames). Those must never reach the browser: they are logged on the server and the merchant sees a plain
 * sentence. Validation messages written for merchants (wrong file type, too large, not found...) are shown as they are.
 */
export const MEDIA_GENERIC_ERROR =
  "We couldn't save this file right now. Please try again in a moment, and contact support if it keeps happening.";

/** Anything that looks like server internals. Checked first: a safe-looking prefix cannot make these visible. */
const INTERNALS = new RegExp(
  [
    "\\bE(ACCES|NOENT|NOSPC|PERM|EXIST|ROFS|ISDIR|NOTDIR|MFILE|CONN\\w*|TIMEDOUT|PIPE)\\b",
    "\\b(AccessDenied|NoSuchBucket|NoSuchKey|SignatureDoesNotMatch|InvalidAccessKeyId|AuthorizationHeaderMalformed)\\b",
    "Security violation",
    "[A-Za-z]:\\\\",
    "(^|[\\s'\"(])/(data|app|usr|var|home|tmp|etc|opt|root|srv|mnt|repo|node_modules)/",
    "\\.r2\\.cloudflarestorage\\.com|amazonaws\\.com|cloudflarestorage",
    "postgres(ql)?://",
    "\\bat\\s+\\S+\\s+\\(",
    "\\.(ts|js|mjs|tsx):\\d+",
    "\\bpg_|relation \"|violates .* constraint|duplicate key value",
  ].join("|"),
  "i",
);

const SAFE_PREFIX = /^(Bad Request|Not Found|Forbidden|Unauthorized|Conflict|Precondition|Validation Error)\b/;

/** Messages the media code writes for merchants (see media-services.ts, media/types.ts, quotas). */
const SAFE_PHRASES: readonly RegExp[] = [
  /^SVG uploads are disabled/,
  /^Unsupported media format/,
  /^File verification failed/,
  /^File content does not match/,
  /^Failed to process image metadata/,
  /^Uploaded file is empty/,
  /^Uploaded file not found in storage/,
  /^File size/,
  /^Replacement file must be/,
  /^Cannot (permanently )?delete/,
  /^Image storage is not set up/,
  /^Storage is not configured/,
  /^Media not found/,
];

export interface MerchantMediaError {
  /** The text to show. The generic sentence when `expose` is false. */
  message: string;
  /** True when the original message was written for merchants and is shown unchanged. */
  expose: boolean;
}

export function merchantMediaError(err: unknown): MerchantMediaError {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const text = raw.trim();
  if (!text || INTERNALS.test(text)) return { message: MEDIA_GENERIC_ERROR, expose: false };
  if (SAFE_PREFIX.test(text) || SAFE_PHRASES.some((re) => re.test(text))) {
    return { message: text.replace(/^(Bad Request|Not Found|Forbidden|Unauthorized|Conflict|Precondition|Validation Error):\s*/, ""), expose: true };
  }
  return { message: MEDIA_GENERIC_ERROR, expose: false };
}
