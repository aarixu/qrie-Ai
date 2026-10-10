-- QRIE: the number of rows in every table of the schemas a restore is judged
-- by, one "schema.table<TAB>rows" line each.
--
-- qrie-backup runs it against the live database right after each dump and
-- uploads the answer beside the dump (qrie-db-<time>.counts.tsv).
-- RESTORE-DRILL.md runs it against the restored copy and compares the two.
--
-- Tables the connecting role may not read are left out rather than failing
-- the whole count.
select n.nspname || '.' || c.relname as table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint
         as row_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname in ('lms', 'public', 'auth', 'storage', 'supabase_migrations')
  and has_table_privilege(c.oid, 'select')
order by 1;
