-- Expand-only: lets a merchant list a discount code in the storefront coupon cards. Off for every existing discount.
ALTER TABLE "discounts" ADD COLUMN "show_on_storefront" boolean DEFAULT false NOT NULL;
