import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

export const searchLatency = new Trend("search_duration");
export const errorRate = new Rate("search_errors");

export const options = {
  stages: [
    { duration: "5s", target: 4 },
    { duration: "10s", target: 8 },
    { duration: "5s", target: 0 },
  ],
  thresholds: {
    search_duration: ["p(95)<400"],
    search_errors: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.TARGET_URL || "http://host.docker.internal:3000";
const HOST = __ENV.TARGET_HOST || "store-b.localhost";
const QUERIES = ["shirt", "apparel", "premium", "item", "product", "artisan"];

export default function () {
  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];

  // Search page
  const pageRes = http.get(`${BASE_URL}/search?q=${query}`, {
    headers: { Host: HOST },
    tags: { name: "search_page" },
  });
  searchLatency.add(pageRes.timings.duration);
  const okPage = check(pageRes, {
    "search page is 200": (r) => r.status === 200,
  });
  errorRate.add(!okPage);

  // Suggestions API
  const sugRes = http.get(`${BASE_URL}/api/storefront/search/suggestions?q=${query}`, {
    headers: { Host: HOST },
    tags: { name: "search_suggestions_api" },
  });
  searchLatency.add(sugRes.timings.duration);
  const okSug = check(sugRes, {
    "suggestions status ok": (r) => r.status === 200 || r.status === 404,
  });
  errorRate.add(!okSug);

  sleep(0.1);
}
