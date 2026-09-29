INSERT INTO "feature_flags" ("key", "default_on", "rules", "kill_switch", "created_at", "updated_at")
VALUES
  ('catalog', true, '{"description": "Product catalog and discovery"}'::jsonb, false, now(), now()),
  ('checkout', true, '{"description": "Order placement and checkout processing"}'::jsonb, false, now(), now()),
  ('fulfillment', true, '{"description": "Order shipping and fulfillment operations"}'::jsonb, false, now(), now())
ON CONFLICT ("key") DO UPDATE SET "default_on" = EXCLUDED."default_on";
