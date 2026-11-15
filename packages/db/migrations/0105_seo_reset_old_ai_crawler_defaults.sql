-- SEO/GEO/AEO (docs/SEO-GEO-AEO-PLAN.md section 3.1). Data-only, no schema change: rollback is a redeploy of the old image.
-- Until now every store's seo_settings row was written with five switches nobody chose: they block GPTBot, ClaudeBot, PerplexityBot,
-- Google-Extended and CCBot, which keeps the store out of AI answers. The code default has changed (search and user agents allowed,
-- only CCBot and Bytespider blocked). A row that still holds exactly the old default is reset to NULL so it follows the code default
-- from now on; a row with any other content was edited by the merchant and is left alone.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM "tenants" LOOP
    -- seo_settings is FORCE ROW LEVEL SECURITY: scope this transaction to one tenant at a time.
    PERFORM set_config('app.tenant_id', t.id::text, true);
    UPDATE "seo_settings"
    SET "ai_crawlers" = NULL, "updated_at" = now()
    WHERE "tenant_id" = t.id
      AND "ai_crawlers" = '{"GPTBot":"block","ClaudeBot":"block","PerplexityBot":"block","Google-Extended":"block","CCBot":"block"}'::jsonb;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
