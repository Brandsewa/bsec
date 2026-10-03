ALTER TABLE "orders" ADD COLUMN "tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;
