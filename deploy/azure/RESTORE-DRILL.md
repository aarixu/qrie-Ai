# Restore drill

A backup nobody has restored is a hope. This drill takes one night's backup
from Blob storage, restores it into a scratch PostgreSQL 17, and compares the
number of rows in every table with the numbers the live database had when the
backup was made.

Do it once after the first backup, then monthly, and after any change to
`qrie-backup.sh`, `backup.env` or the Supabase project's PostgreSQL version.

Written 2026-10-10; **not yet run.** The kinds of error listed in step 4 are
expected from how pg_dump and Supabase work, not seen. Write down what the
first drill really shows.

**What it proves:** the file in Blob storage downloads, reads, restores into
plain PostgreSQL, and holds the rows the live database had.

**What it does not prove:** that you could move the school onto a new Supabase
project. That is a different job, not rehearsed; see "Restoring for real"
below and README.md, "What a backup holds and what it does not".

Everything below runs **on the VM**, which already has the PGDG package source,
the PostgreSQL 17 client and azcopy (setup-server.sh). The drill installs the
PostgreSQL 17 server for an hour and removes it afterwards. The VM runs no
database of its own, so the cluster `17/main` that the install creates is the
drill's alone. It listens on localhost only (Ubuntu's default), and ufw lets
nothing in on 5432 anyway.

## 1. Pick a backup (founder, Azure portal)

Storage account, Containers, your backup container, `db/`. Take the newest
`qrie-db-<time>.dump` and the `qrie-db-<time>.counts.tsv` with the same time
(the time is UTC, so a 02:30 India-time run is named `...T2100..Z`, the day
before in UTC). If there is no
`.counts.tsv`, that night's row count failed (the journal says why): use the
newest night that has both.

For each of the two files: **Generate SAS**, permission **Read** only, expiry
one hour, then copy its **Blob SAS URL**.

## 2. Install a scratch PostgreSQL 17 and download (founder, on the VM)

```bash
sudo apt-get install -y postgresql-17
pg_lsclusters                      # expect: 17  main  5432  online
sudo install -d -m 0700 -o postgres -g postgres /var/tmp/qrie-drill
# Keep the single quotes: the addresses contain &.
sudo -u postgres azcopy copy '<the .dump file Blob SAS URL>' /var/tmp/qrie-drill/drill.dump
sudo -u postgres azcopy copy '<the .counts.tsv Blob SAS URL>' /var/tmp/qrie-drill/at-backup.tsv
```

## 3. Restore (founder, on the VM)

```bash
# The dump's row-level security policies name these roles; on Supabase they
# always exist, on plain PostgreSQL they must be made first.
sudo -u postgres psql -X -c 'create role anon nologin' -c 'create role authenticated nologin' -c 'create role service_role nologin'
sudo -u postgres createdb qrie_drill
sudo -u postgres pg_restore --no-owner --no-acl -d qrie_drill /var/tmp/qrie-drill/drill.dump 2> ~/qrie-drill-errors.txt
echo "pg_restore exit code: $?"
```

`--no-owner --no-acl` leaves out who owns each object and the grants, which
name Supabase's own roles. A non-zero exit code is expected: pg_restore goes on
past each error and counts them. Step 5 decides whether the restore is good.

## 4. Read the errors (founder, on the VM)

```bash
grep -c 'error:' ~/qrie-drill-errors.txt
grep 'error:' ~/qrie-drill-errors.txt | sed 's/^.*error: //' | sort | uniq -c | sort -rn | head -40
```

Expected, because plain PostgreSQL is not Supabase:

- extensions it does not have, such as `pg_graphql`, `pg_cron`, `pg_net`,
  `pgsodium`, `supabase_vault` (`extension "..." is not available`), and then
  every object that belongs to or calls one of them;
- event triggers and functions that call Supabase's own functions;
- grants or policies naming a Supabase role other than the three made above.

Not expected, and a failed drill: an error that names a table in `lms` or
`public`.

## 5. Compare the row counts (founder, on the VM)

```bash
sudo -u postgres psql -X -q -A -t -F $'\t' -d qrie_drill -f /usr/local/share/qrie/row-counts.sql | LC_ALL=C sort > ~/restored.tsv
sudo cat /var/tmp/qrie-drill/at-backup.tsv > ~/at-backup.tsv
diff ~/at-backup.tsv ~/restored.tsv && echo 'Every table has the same number of rows.'
sudo -u postgres psql -X -d qrie_drill -c 'select max(version) from supabase_migrations.schema_migrations'
```

`row-counts.sql` is the file the backup ran against the live database right
after the dump: every table in `lms`, `public`, `auth`, `storage` and
`supabase_migrations`, one line each.

- **Pass:** `diff` prints nothing, and the newest migration is the one the
  project has.
- **A line only on the left** (`<`): that table did not restore. Find its name
  in `~/qrie-drill-errors.txt`.
- **A small difference in a table the apps write to at night**: the count
  runs in its own session just after the dump, so a row written in between
  shows here. A table at 0 that had rows, or a missing table, is a failure.

## 6. Clean up (founder, on the VM)

```bash
sudo -u postgres dropdb qrie_drill
sudo pg_dropcluster --stop 17 main
sudo apt-get purge -y postgresql-17
sudo rm -rf /var/tmp/qrie-drill /var/lib/postgresql/.azcopy
rm -f ~/qrie-drill-errors.txt ~/restored.tsv ~/at-backup.tsv
```

The two read-only SAS addresses stop working on their own after the hour.

## 7. Write it down (founder)

The date, the backup's file name, pass or fail, the number of errors and the
kinds, and how long it took. If the admin console is deployed, its System page
has "Record a restore drill" (`docs/ops/admin-console.md` on the admin branch).

## Restoring for real

Not rehearsed, and **NOT VERIFIED**. Before restoring anything over the live
project, stop and think: a restore over a working database can destroy every
change made since the backup.

Moving to a new Supabase project would need, at the least:

- a new project in the same region, with the extensions the old one had
  switched on;
- the `lms` and `public` schemas and their rows from the dump (`pg_restore -n lms -n public`);
- pg_cron switched on, and its jobs scheduled again as the migrations
  schedule them: a restore of `lms` and `public` does not bring back the
  `cron` schema's jobs. `lms-finalize-tests` runs `select lms.finalize_tests();`
  every minute (`cron.schedule('lms-finalize-tests', '* * * * *', ...)` in
  `supabase/migrations/0030_lms_test_saves_and_checks.sql`); without it, a
  test whose time ran out before the child handed it in is handed in only
  when its teacher releases the results. The tutor's `purge-old-ledger`
  (`0009_retention_schedule.sql`) is scheduled the same way;
- the accounts: the rows of `auth.users` and `auth.identities` from the dump,
  into the new project's own `auth` schema, data only;
- the same `LMS_PIN_PEPPER` (from your password manager), or every PIN stops
  working (`tools/lms-import/src/pinGuard.ts`);
- the photos of work, which are not in the dump at all (README.md);
- the settings in README.md step 9 again, and new keys in the apps (step 10).

Supabase's guide "Backup and restore using the CLI" is the place to start.
