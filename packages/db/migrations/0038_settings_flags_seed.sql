-- 0038_settings_flags_seed.sql
-- Seed feature flags for Settings rebuild phases 3-8 (ADR-011, default_on = false)

INSERT INTO "feature_flags" ("key", "default_on", "rules", "kill_switch", "created_at", "updated_at")
VALUES
  ('settings.gst_v2', false, '{"description": "GST v2 calculation, breakdown, and B2B invoice generation"}'::jsonb, false, now(), now()),
  ('settings.policies', false, '{"description": "Merchant customized policy versions and revision control"}'::jsonb, false, now(), now()),
  ('settings.customer_accounts', false, '{"description": "Customer account self-service login and security controls"}'::jsonb, false, now(), now()),
  ('settings.notifications', false, '{"description": "Granular store and customer email notification preferences"}'::jsonb, false, now(), now()),
  ('settings.storage', false, '{"description": "Merchant storage quota and usage breakdown view"}'::jsonb, false, now(), now()),
  ('settings.maintenance', false, '{"description": "Storefront maintenance scheduling and transition tracking"}'::jsonb, false, now(), now())
ON CONFLICT ("key") DO NOTHING;
