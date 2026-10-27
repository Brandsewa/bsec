-- Expand-only: how a review got here (shopper, added by hand, imported). Existing rows are shopper reviews.
ALTER TABLE "reviews" ADD COLUMN "source" text DEFAULT 'customer' NOT NULL;
