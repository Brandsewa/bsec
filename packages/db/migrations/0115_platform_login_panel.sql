-- The content panel next to the admin sign-in form (heading, text, colours, optional picture) is edited in the Super Admin.
-- Expand step: one nullable column on the single-row platform_settings table; NULL means the built-in default panel.
-- Existing grants stand (app_rw reads for the public sign-in page, app_platform writes).
ALTER TABLE "platform_settings" ADD COLUMN "login_panel" jsonb;
