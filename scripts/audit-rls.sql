-- Platform audit (docs/PLATFORM-AUDIT-PLAN.md section A1): row-level security coverage of a migrated database.
-- Read-only. Run against a freshly migrated LOCAL or test database, never production without the owner's yes:
--
--   psql "$DATABASE_URL_SUPERUSER" -At -f scripts/audit-rls.sql
--
-- Each block prints a heading and then the rows that need a human look. An empty block is a pass. Block 1 is never
-- empty: the platform tables (platform_audit_logs, subscriptions, domains, webhook_inbox ...) carry a tenant_id without
-- row-level security on purpose; a NEW name there is the thing to catch. Baseline: docs/audit/2026-11-A1-tenant-isolation.md.

\echo '== 1. tables with tenant_id but without ENABLE + FORCE row-level security or without a policy'
select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
  and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
  and (not c.relrowsecurity or not c.relforcerowsecurity or not exists (select 1 from pg_policy p where p.polrelid = c.oid))
order by 1;

\echo '== 2. tenant_id columns that allow NULL'
select c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
where n.nspname = 'public' and c.relkind in ('r', 'p') and not a.attnotnull
order by 1;

\echo '== 3. policies that are not the standard tenant_isolation predicate (name, command, permissive, using, check)'
select c.relname, p.polname, p.polcmd, p.polpermissive,
       pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (p.polname <> 'tenant_isolation'
    or pg_get_expr(p.polqual, p.polrelid) not like '%tenant_id = (NULLIF(current_setting(''app.tenant_id''::text, true), ''''::text))::uuid%'
    or p.polwithcheck is null or p.polcmd <> '*' or p.polroles <> '{0}')
order by 1, 2;

\echo '== 4. foreign keys between two tenant_id tables that do not include tenant_id (rule 1: tenantForeignKey)'
with t as (
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
)
select s.relname || '.' || (select string_agg(a.attname, ',') from pg_attribute a where a.attrelid = k.conrelid and a.attnum = any (k.conkey)) || ' -> ' || d.relname
from pg_constraint k join t s on s.oid = k.conrelid join t d on d.oid = k.confrelid
where k.contype = 'f'
  and not exists (select 1 from pg_attribute a where a.attrelid = k.conrelid and a.attnum = any (k.conkey) and a.attname = 'tenant_id')
order by 1;

\echo '== 5. unique indexes on RLS tables that leave out tenant_id (a value taken in one store blocks it in another)'
select c.relname, i.relname
from pg_index x join pg_class c on c.oid = x.indrelid join pg_class i on i.oid = x.indexrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and x.indisunique and not x.indisprimary and c.relrowsecurity
  and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum = any (x.indkey) and a.attname = 'tenant_id')
order by 1, 2;

\echo '== 6. role attributes (only app_platform may bypass row-level security; none may be superuser)'
select rolname, rolbypassrls, rolsuper from pg_roles where rolname like 'app\_%' order by 1;

\echo '== 7. table privileges of the store runtime roles on tables WITHOUT row-level security (isolation there is application code only)'
select g.grantee, g.table_name, string_agg(g.privilege_type, ',' order by g.privilege_type)
from information_schema.role_table_grants g
join pg_class c on c.relname = g.table_name join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where g.table_schema = 'public' and g.grantee in ('app_rw', 'app_saas', 'PUBLIC') and not c.relrowsecurity
group by 1, 2 order by 1, 2;

\echo '== 8. SECURITY DEFINER functions (each needs a fixed search_path)'
select p.proname, p.proowner::regrole, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef order by 1;
