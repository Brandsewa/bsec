import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

export const browseLatency = new Trend("storefront_browse_duration");
export const errorRate = new Rate("storefront_browse_errors");

export const options = {
  stages: [
    { duration: "5s", target: 4 },
    { duration: "10s", target: 8 },
    { duration: "5s", target: 0 },
  ],
  thresholds: {
    storefront_browse_duration: ["p(95)<400"], // PLAN §14 Uncached p95 SLA
    storefront_browse_errors: ["rate<0.01"],    // <1% errors
  },
};

const BASE_URL = __ENV.TARGET_URL || "http://host.docker.internal:3000";
const HOST = __ENV.TARGET_HOST || "store-b.localhost";

export default function () {
  const prodNum = Math.floor(Math.random() * 20) + 1;
  const urls = [
    `${BASE_URL}/`,
    `${BASE_URL}/search`,
    `${BASE_URL}/products/store-b-product-${prodNum}`,
  ];

  for (const url of urls) {
    const res = http.get(url, {
      headers: {
        Host: HOST,
        "User-Agent": "k6-load-test/1.0",
      },
      tags: { name: url.split("/")[3] || "home" },
    });

    browseLatency.add(res.timings.duration);
    const ok = check(res, {
      "status is 200": (r) => r.status === 200,
    });
    errorRate.add(!ok);
  }

  sleep(0.1);
}
