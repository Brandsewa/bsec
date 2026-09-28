import { describe, expect, it } from "vitest";
import {
  storeContract,
  StorefrontCart,
  StorefrontCartItem,
  StorefrontSearchOutput,
  StorefrontSuggestionsOutput,
  ShippingEstimateOutput,
  NewsletterSubscribeOutput,
  StatusVerifyPasswordOutput,
} from "../src/index.ts";

describe("Storefront Contracts", () => {
  it("defines storefront contract routes on storeContract", () => {
    expect(storeContract.storefront).toBeDefined();
    expect(storeContract.storefront.search).toBeDefined();
    expect(storeContract.storefront.searchSuggestions).toBeDefined();
    expect(storeContract.storefront.cart.get).toBeDefined();
    expect(storeContract.storefront.cart.addItem).toBeDefined();
    expect(storeContract.storefront.cart.updateItem).toBeDefined();
    expect(storeContract.storefront.cart.removeItem).toBeDefined();
    expect(storeContract.storefront.cart.clear).toBeDefined();
    expect(storeContract.storefront.cart.estimateShipping).toBeDefined();
    expect(storeContract.storefront.newsletter.subscribe).toBeDefined();
    expect(storeContract.storefront.status.verifyPassword).toBeDefined();
  });

  it("validates search input and output schema", () => {
    const searchRoute = storeContract.storefront.search;
    expect(searchRoute["~orpc"]?.route?.method).toBe("GET");
    expect(searchRoute["~orpc"]?.route?.path).toBe("/storefront/search");

    const validResult = StorefrontSearchOutput.safeParse({
      items: [
        {
          id: "p1",
          title: "T-Shirt",
          slug: "t-shirt",
          priceMin: 5000,
          priceMax: 7000,
          compareAtPriceMin: 8000,
          compareAtPriceMax: 9000,
          hasVariants: true,
          primaryMedia: {
            id: "m1",
            storageKey: "key/1",
            cfImageId: null,
            alt: "A shirt",
            width: 800,
            height: 600,
          },
        },
      ],
      total: 1,
    });
    expect(validResult.success).toBe(true);
  });

  it("validates searchSuggestions input and output schema", () => {
    const validSuggestions = StorefrontSuggestionsOutput.safeParse({
      suggestions: [
        {
          id: "p1",
          title: "T-Shirt",
          slug: "t-shirt",
        },
      ],
    });
    expect(validSuggestions.success).toBe(true);
  });

  it("validates cart schemas", () => {
    const sampleCart = {
      id: "c0000000-0000-0000-0000-000000000001",
      token: "tok_123",
      currency: "INR",
      itemCount: 2,
      subtotal: 10000,
      items: [
        {
          id: "i0000000-0000-0000-0000-000000000001",
          cartId: "c0000000-0000-0000-0000-000000000001",
          variantId: "v0000000-0000-0000-0000-000000000001",
          quantity: 2,
          unitPriceSnapshot: 5000,
          lineTotal: 10000,
          properties: { color: "blue" },
          product: {
            id: "p0000000-0000-0000-0000-000000000001",
            title: "T-Shirt",
            slug: "t-shirt",
          },
          variant: {
            id: "v0000000-0000-0000-0000-000000000001",
            sku: "TSHIRT-BLU",
            title: "Blue / L",
            optionValues: { Color: "Blue", Size: "L" },
            price: 5000,
          },
          primaryImage: {
            mediaId: "m0000000-0000-0000-0000-000000000001",
            alt: "Blue Shirt",
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    expect(StorefrontCart.safeParse(sampleCart).success).toBe(true);
  });

  it("validates shipping estimate and newsletter output schemas", () => {
    const validShipping = ShippingEstimateOutput.safeParse({
      serviceable: true,
      pincode: "110001",
      rates: [
        {
          id: "standard",
          name: "Standard Delivery",
          amountPaise: 5000,
          estimatedDays: "4-7 business days",
        },
      ],
    });
    expect(validShipping.success).toBe(true);

    const validNewsletter = NewsletterSubscribeOutput.safeParse({
      success: true,
      message: "Subscribed successfully",
    });
    expect(validNewsletter.success).toBe(true);

    const validVerifyPassword = StatusVerifyPasswordOutput.safeParse({
      success: true,
      token: "sample-token",
    });
    expect(validVerifyPassword.success).toBe(true);
  });
});
