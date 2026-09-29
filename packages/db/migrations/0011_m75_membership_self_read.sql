-- A signed-in staff user may read their OWN membership rows across stores (store switcher and /me).
-- Permissive policies OR together: this only adds visibility when app.user_id is set, and only for that user's rows.
DROP POLICY IF EXISTS "memberships_self_read" ON "memberships";--> statement-breakpoint
CREATE POLICY "memberships_self_read" ON "memberships" AS PERMISSIVE FOR SELECT TO public USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
