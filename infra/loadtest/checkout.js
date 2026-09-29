import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

export const checkoutLatency = new Trend("checkout_duration");
export const errorRate = new Rate("checkout_errors");

export const options = {
  stages: [
    { duration: "5s", target: 3 },
    { duration: "10s", target: 6 },
    { duration: "5s", target: 0 },
  ],
  thresholds: {
    checkout_duration: ["p(95)<450"],
    checkout_errors: ["rate<0.02"],
  },
};

const BASE_URL = __ENV.TARGET_URL || "http://host.docker.internal:3000";
const HOST = __ENV.TARGET_HOST || "store-b.localhost";
const VARIANT_ID = "0199a074-0002-7000-8000-000100000001"; // Seeded Store B Variant 1

export default function () {
  // 1. Initialize Cart
  const getRes = http.get(`${BASE_URL}/api/storefront/cart`, {
    headers: { Host: HOST },
  });
  let cartToken = "";
  try {
    cartToken = JSON.parse(getRes.body)?.cart?.token || "";
  } catch {}

  if (!cartToken) return;

  // 2. Add Item
  http.post(
    `${BASE_URL}/api/storefront/cart/items`,
    JSON.stringify({ variantId: VARIANT_ID, quantity: 1 }),
    {
      headers: {
        Host: HOST,
        "Content-Type": "application/json",
        Cookie: `bs_cart_token=${cartToken}`,
      },
    },
  );

  // 3. Place Order (COD)
  const placePayload = JSON.stringify({
    email: `shopper_${Date.now()}_${Math.floor(Math.random()*10000)}@example.com`,
    phone: "9876543210",
    fullName: "Hardening Test Customer",
    addressLine1: "100 Gateway Blvd, BKC",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400051",
    shippingMethod: "standard",
    paymentMethod: "cod",
  });

  const res = http.post(`${BASE_URL}/api/storefront/checkout/place-order`, placePayload, {
    headers: {
      Host: HOST,
      "Content-Type": "application/json",
      Cookie: `bs_cart_token=${cartToken}`,
    },
    tags: { name: "place_order" },
  });

  checkoutLatency.add(res.timings.duration);
  const ok = check(res, {
    "order placed successfully": (r) => r.status === 200 || r.status === 201,
  });
  errorRate.add(!ok);

  sleep(0.1);
}
