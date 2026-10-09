ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "parent_id" uuid;
DO $$ BEGIN
  ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_fk" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "pages"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "pages_tenant_parent_idx" ON "pages" USING btree ("tenant_id", "parent_id");
