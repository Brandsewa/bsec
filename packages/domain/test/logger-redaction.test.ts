import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { pino } from "pino";
import { LOG_REDACT_PATHS } from "../src/logger.ts";

// Audit A6-01: secrets must not reach a log line, including those nested inside an error's request or config.
function logOnce(obj: Record<string, unknown>): string {
  let out = "";
  const sink = new Writable({ write(chunk, _enc, cb) { out += chunk.toString(); cb(); } });
  pino({ redact: LOG_REDACT_PATHS }, sink).info(obj, "x");
  return out;
}

describe("log redaction", () => {
  it("removes credentials, signatures, provider keys and codes at the paths where they turn up", () => {
    const secrets = ["tok_live_SECRET1", "sess=SECRET2", "whsec_SECRET3", "SECRET4", "SECRET5", "SECRET6", "123456SECRET7", "SECRET8"];
    const line = logOnce({
      req: { headers: { authorization: `Bearer ${secrets[0]}`, cookie: secrets[1], "x-support-token": secrets[0], "stripe-signature": secrets[2] } },
      err: { config: { headers: { Authorization: secrets[0] } }, request: { headers: { authorization: secrets[0] } } },
      body: { password: secrets[3], keySecret: secrets[4], webhookSecret: secrets[2], secretKey: secrets[5], otp: secrets[6], refresh_token: secrets[7] },
    });
    for (const s of secrets) expect(line, s).not.toContain(s.replace("Bearer ", ""));
    expect(line).toContain("[Redacted]");
  });

  it("keeps ordinary fields", () => {
    expect(logOnce({ tenant_id: "t-1", orderId: "o-1" })).toContain("o-1");
  });
});
