import { describe, expect, it } from "vitest";
import { isPlaceholderCustomerEmail, placeholderEmailForPhone } from "../src/customers/placeholder-email.ts";

// Audit A2-06: the stand-in address for a phone-only customer must never be a real mailbox.
describe("placeholder customer email", () => {
  it("new placeholders use the reserved .invalid domain", () => {
    expect(placeholderEmailForPhone("9876543210")).toBe("9876543210@phone.invalid");
  });

  it("recognises both the new and the legacy placeholder, and nothing else", () => {
    expect(isPlaceholderCustomerEmail("9876543210@phone.invalid")).toBe(true);
    expect(isPlaceholderCustomerEmail("9876543210@customer.store")).toBe(true);
    expect(isPlaceholderCustomerEmail(" 9876543210@PHONE.INVALID ")).toBe(true);
    expect(isPlaceholderCustomerEmail("asha@example.com")).toBe(false);
    expect(isPlaceholderCustomerEmail("asha@customer.store.example.com")).toBe(false);
    expect(isPlaceholderCustomerEmail(null)).toBe(false);
  });
});
