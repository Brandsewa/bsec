// DEVELOPER MACHINE SMOKE SCRIPT ONLY
// This script is a lightweight smoke check intended for local developer container validation.
// It is NOT a full production-scale noisy-neighbour load test. Production load testing is deferred post-M9.
// Never run against production (server.brandsewa.com).

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

export const storeBCheckoutLatency = new Trend("store_b_checkout_duration");
export const storeBBrowseLatency = new Trend("store_b_browse_duration");
export const storeANoisyLatency = new Trend("store_a_noisy_duration");
export const storeAThrottledCounter = new Counter("store_a_throttled_429");
export const storeBErrorRate = new Rate("store_b_errors");

export const options = {
  scenarios: {
    // Store A: Aggressive Noisy Neighbour generating heavy traffic
    noisy_neighbor_store_a: {
      executor: "ramping-vus",
      startVUs: 2,
      stages: [
        { duration: "5s", target: 4 },
        { duration: "10s", target: 6 },
        { duration: "5s", target: 0 },
      ],
      gracefulRampDown: "0s",
      exec: "noisyStoreA",
    },
    // Store B: Real Shoppers browsing and checking out
    target_shopper_store_b: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "5s", target: 2 },
        { duration: "10s", target: 3 },
        { duration: "5s", target: 0 },
      ],
      gracefulRampDown: "0s",
      exec: "targetStoreB",
    },
  },
  thresholds: {
    // PLAN §14 SLA: Store B p95 latency must stay < 500ms under heavy neighbor load
    store_b_checkout_duration: ["p(95)<500"],
    store_b_browse_duration: ["p(95)<400"],
    store_b_errors: ["rate<0.02"],
  },
};

const BASE_URL = __ENV.TARGET_URL || "http://host.docker.internal:3000";
const STORE_A_HOST = "store-a.localhost";
const STORE_B_HOST = "store-b.localhost";
const STORE_B_VARIANT = "0199a074-0002-7000-8000-000100000001";

// Store A: Floods server with heavy catalog and search queries
export function noisyStoreA() {
  const p = Math.floor(Math.random() * 50) + 1;
  const urls = [
    `${BASE_URL}/products/store-a-product-${p}`,
    `${BASE_URL}/search?q=apparel`,
    `${BASE_URL}/api/storefront/cart`,
  ];
  const url = urls[Math.floor(Math.random() * urls.length)];

  const res = http.get(url, {
    headers: {
      Host: STORE_A_HOST,
      "User-Agent": "k6-noisy-neighbour-test",
    },
    tags: { tenant: "store_a_noisy" },
  });

  storeANoisyLatency.add(res.timings.duration);

  // If Store A gets throttled by per-tenant rate limit (HTTP 429), track it
  if (res.status === 429) {
    storeAThrottledCounter.add(1);
  }

  sleep(0.02); // very rapid requests
}

// Store B: Standard customer browse -> add to cart -> checkout
export function targetStoreB() {
  const p = Math.floor(Math.random() * 20) + 1;

  // 1. Browse PDP
  const browseRes = http.get(`${BASE_URL}/products/store-b-product-${p}`, {
    headers: { Host: STORE_B_HOST },
    tags: { tenant: "store_b_browse" },
  });
  storeBBrowseLatency.add(browseRes.timings.duration);
  const okBrowse = check(browseRes, {
    "Store B browse ok": (r) => r.status === 200,
  });
  storeBErrorRate.add(!okBrowse);

  // 2. Fetch/Create Cart
  const cartRes = http.get(`${BASE_URL}/api/storefront/cart`, {
    headers: { Host: STORE_B_HOST },
    tags: { tenant: "store_b_cart" },
  });
  let token = "";
  try {
    token = JSON.parse(cartRes.body)?.cart?.token || "";
  } catch {}

  if (token) {
    // 3. Add to Cart
    http.post(
      `${BASE_URL}/api/storefront/cart/items`,
      JSON.stringify({ variantId: STORE_B_VARIANT, quantity: 1 }),
      {
        headers: {
          Host: STORE_B_HOST,
          "Content-Type": "application/json",
          Cookie: `bs_cart_token=${token}`,
        },
      },
    );

    // 4. Place Checkout Order
    const placePayload = JSON.stringify({
      email: `shopper_b_${Date.now()}_${Math.floor(Math.random()*10000)}@example.com`,
      phone: "9876543210",
      fullName: "Store B Benchmark Shopper",
      addressLine1: "42 MG Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      shippingMethod: "standard",
      paymentMethod: "cod",
    });

    const checkoutRes = http.post(
      `${BASE_URL}/api/storefront/checkout/place-order`,
      placePayload,
      {
        headers: {
          Host: STORE_B_HOST,
          "Content-Type": "application/json",
          Cookie: `bs_cart_token=${token}`,
        },
        tags: { tenant: "store_b_checkout" },
      },
    );

    storeBCheckoutLatency.add(checkoutRes.timings.duration);
    const okCheckout = check(checkoutRes, {
      "Store B checkout ok": (r) => r.status === 200 || r.status === 201,
    });
    storeBErrorRate.add(!okCheckout);
  }

  sleep(0.1);
}
