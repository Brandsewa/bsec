import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

export const cartLatency = new Trend("cart_duration");
export const errorRate = new Rate("cart_errors");

export const options = {
  stages: [
    { duration: "5s", target: 4 },
    { duration: "10s", target: 8 },
    { duration: "5s", target: 0 },
  ],
  thresholds: {
    cart_duration: ["p(95)<400"],
    cart_errors: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.TARGET_URL || "http://host.docker.internal:3000";
const HOST = __ENV.TARGET_HOST || "store-b.localhost";
const VARIANT_ID = "0199a074-0002-7000-8000-000100000001"; // Seeded Store B Variant 1

export default function () {
  // 1. Fetch/Create Cart
  const getRes = http.get(`${BASE_URL}/api/storefront/cart`, {
    headers: { Host: HOST },
    tags: { name: "get_cart" },
  });
  cartLatency.add(getRes.timings.duration);
  const okGet = check(getRes, {
    "get cart ok": (r) => r.status === 200,
  });
  errorRate.add(!okGet);

  let cartToken = "";
  try {
    const data = JSON.parse(getRes.body);
    cartToken = data.cart?.token || "";
  } catch {}

  // 2. Add Item to Cart
  const addPayload = JSON.stringify({
    variantId: VARIANT_ID,
    quantity: 1,
  });

  const addRes = http.post(`${BASE_URL}/api/storefront/cart/items`, addPayload, {
    headers: {
      Host: HOST,
      "Content-Type": "application/json",
      Cookie: `bs_cart_token=${cartToken}`,
    },
    tags: { name: "add_to_cart" },
  });
  cartLatency.add(addRes.timings.duration);
  const okAdd = check(addRes, {
    "add item ok": (r) => r.status === 200,
  });
  errorRate.add(!okAdd);

  sleep(0.1);
}
