-- Opt-in "Settings update available" prompt: while this flag is on for a store, its owner is offered the new
-- Settings features (the six settings.* flags) with Update now / Don't update. Off by default; Super Admin opens
-- the offer when the platform is ready for stores to adopt.
INSERT INTO "feature_flags" ("key", "default_on", "rules", "kill_switch", "created_at", "updated_at")
VALUES ('settings.update_offer', false, '{"description": "Offer store owners the new Settings features with an Update now / Don''t update prompt"}'::jsonb, false, now(), now())
ON CONFLICT ("key") DO NOTHING;
