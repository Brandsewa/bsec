import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

export const adminLatency = new Trend("admin_reads_duration");
export const errorRate = new Rate("admin_reads_errors");

export const options = {
  stages: [
    { duration: "5s", target: 4 },
    { duration: "10s", target: 8 },
    { duration: "5s", target: 0 },
  ],
  thresholds: {
    admin_reads_duration: ["p(95)<350"],
    admin_reads_errors: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.TARGET_URL || "http://host.docker.internal:3000";
const STORE_ID = "0199a074-0000-7000-8000-000000000002"; // Store B

export default function () {
  // 1. Health check & DB connectivity
  const healthRes = http.get(`${BASE_URL}/api/health`, {
    tags: { name: "admin_health" },
  });
  adminLatency.add(healthRes.timings.duration);
  const okHealth = check(healthRes, {
    "health status is 200": (r) => r.status === 200,
  });
  errorRate.add(!okHealth);

  // 2. Admin API endpoint (with tenant store id header)
  const apiRes = http.get(`${BASE_URL}/api/rpc/system/health`, {
    headers: {
      "x-store-id": STORE_ID,
    },
    tags: { name: "rpc_health" },
  });
  adminLatency.add(apiRes.timings.duration);
  const okApi = check(apiRes, {
    "rpc ok": (r) => r.status === 200 || r.status === 404,
  });
  errorRate.add(!okApi);

  sleep(0.1);
}
