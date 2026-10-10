#!/usr/bin/env bash
# qrie-backup: copy the hosted Supabase database to Azure Blob Storage.
# setup-server.sh installs it as /usr/local/sbin/qrie-backup.
#
# qrie-backup.service runs it, and qrie-backup.timer starts that service every
# night at 02:30 India time. By hand:
#   sudo systemctl start qrie-backup.service
#   journalctl -u qrie-backup.service -n 50
#
# In order, stopping at the first step that fails (the service then shows as
# failed and no heartbeat is sent):
#   1. pg_dump --format=custom of the database, leaving out the schemas in
#      BACKUP_EXCLUDE_SCHEMAS;
#   2. pg_restore --list of the file, to see that it reads back;
#   3. a row count of every table in lms, public, auth, storage and
#      supabase_migrations (row-counts.sql), for RESTORE-DRILL.md. This step
#      alone may fail without stopping the backup: the journal says so and
#      the dump goes up without its counts;
#   4. both files to db/ in the Blob container, with azcopy, its length check
#      after the upload switched off (upload(), below, says why);
#   5. if BACKUP_HEARTBEAT_URL is set, one request to it.
#
# The settings come from /etc/qrie/backup.env (root, 0600), which the service
# reads; backup.env.example lists them. Old backups are deleted by a lifecycle
# rule on the storage account, not here (README.md, "Backups"), so the SAS
# needs no delete permission.
set -euo pipefail
shopt -u patsub_replacement 2>/dev/null || true
umask 077
export LC_ALL=C

log() { printf 'qrie-backup: %s\n' "$*"; }
fail() { printf 'qrie-backup: FAILED: %s\n' "$*" >&2; exit 1; }

# %XX sequences to bytes, for the password part of a URI.
percent_decode() {
  local s=${1//\\/\\\\}
  s=${s//%/\\x}
  printf '%b' "$s"
}

# Sets DB_URL_NO_PASSWORD and DB_PASSWORD from a postgresql:// URI. The
# password then reaches pg_dump and psql through PGPASSWORD, never their
# command lines, which any account on the VM can read while they run (ps).
split_db_url() {
  local url=$1 rest userinfo user pass=''
  case $url in postgres://* | postgresql://*) ;; *) return 1 ;; esac
  rest=${url#*://}
  case $rest in *@*) ;; *) return 1 ;; esac
  userinfo=${rest%@*}
  case $userinfo in
    *:*) user=${userinfo%%:*}; pass=${userinfo#*:} ;;
    *) user=$userinfo ;;
  esac
  DB_URL_NO_PASSWORD="postgresql://$user@${rest##*@}"
  DB_PASSWORD=$(percent_decode "$pass")
}

[ -n "${SUPABASE_DB_URL:-}" ] || fail "SUPABASE_DB_URL is not set (/etc/qrie/backup.env)"
[ -n "${AZURE_BLOB_SAS_URL:-}" ] || fail "AZURE_BLOB_SAS_URL is not set (/etc/qrie/backup.env)"
case $AZURE_BLOB_SAS_URL in
  https://*.blob.core.windows.net/*\?*) ;;
  *) fail "AZURE_BLOB_SAS_URL must look like https://<account>.blob.core.windows.net/<container>?<SAS>" ;;
esac
split_db_url "$SUPABASE_DB_URL" || fail "SUPABASE_DB_URL must look like postgresql://<user>:<password>@<host>:<port>/<database>"
command -v azcopy >/dev/null || fail "azcopy is not installed (setup-server.sh installs it)"

# The newest client installed, since pg_dump refuses a server newer than itself.
bin=
for d in /usr/lib/postgresql/*/bin; do
  if [ -x "$d/pg_dump" ]; then bin=$d; fi
done
[ -n "$bin" ] || fail "no pg_dump under /usr/lib/postgresql (setup-server.sh installs one)"

export PGPASSWORD=$DB_PASSWORD
export PGSSLMODE=${PGSSLMODE:-require}
export PGAPPNAME=qrie-backup
export PGCONNECT_TIMEOUT=30

work=${STATE_DIRECTORY:-/var/lib/qrie-backup}
mkdir -p "$work/azcopy"
export HOME=$work AZCOPY_LOG_LOCATION=$work/azcopy AZCOPY_JOB_PLAN_LOCATION=$work/azcopy

name=qrie-db-$(date -u +%Y%m%dT%H%M%SZ)
dump=$work/$name.dump
counts=$work/$name.counts.tsv
trap 'rm -f -- "$dump" "$counts" "$counts.tmp"' EXIT

# 1 and 2.
read -r -a skip <<< "${BACKUP_EXCLUDE_SCHEMAS-_analytics _realtime _supavisor realtime net pgsodium pgsodium_masks vault supabase_functions}"
args=(--format=custom --no-password --lock-wait-timeout=120000)
for s in "${skip[@]}"; do args+=("--exclude-schema=$s"); done
log "dumping $DB_URL_NO_PASSWORD with $("$bin/pg_dump" --version), leaving out: ${skip[*]:-nothing}"
"$bin/pg_dump" "${args[@]}" --file="$dump" --dbname="$DB_URL_NO_PASSWORD" || fail "pg_dump stopped (its message is above)"
"$bin/pg_restore" --list "$dump" > /dev/null || fail "the dump does not read back (pg_restore --list)"
log "dump ready: $(stat -c %s "$dump") bytes"

# 3.
sql=${QRIE_ROW_COUNTS_SQL:-/usr/local/share/qrie/row-counts.sql}
have_counts=no
if "$bin/psql" -X -q -A -t -F $'\t' -v ON_ERROR_STOP=1 --no-password --dbname="$DB_URL_NO_PASSWORD" -f "$sql" > "$counts.tmp" &&
  sort "$counts.tmp" > "$counts"; then
  have_counts=yes
  log "counted the rows of $(wc -l < "$counts") tables"
else
  log "warning: the row count did not run; the dump goes up without it"
fi

# 4.
container=${AZURE_BLOB_SAS_URL%%\?*}
container=${container%/}
sas=${AZURE_BLOB_SAS_URL#*\?}
upload() { # local file, blob name
  # The SAS is on azcopy's command line while it runs (README.md, "Backups").
  # --check-length=false: azcopy's length check after an upload (on by default)
  # reads the blob's properties, which takes Read, and the SAS may only Create
  # and Write. The dump was read back here already (pg_restore --list), and
  # --put-md5 stores its MD5 with the blob for a download to compare.
  azcopy copy "$1" "$container/db/$2?$sas" --check-length=false --put-md5 --log-level=WARNING > /dev/null ||
    fail "azcopy could not upload db/$2 (its log is under $work/azcopy)"
  log "uploaded db/$2"
}
upload "$dump" "$name.dump"
if [ "$have_counts" = yes ]; then upload "$counts" "$name.counts.tsv"; fi
rm -rf -- "${work:?}/azcopy/"*

# 5.
if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  if curl -fsS -m 20 --retry 3 -o /dev/null "$BACKUP_HEARTBEAT_URL"; then
    log "heartbeat sent"
  else
    log "warning: the heartbeat did not go through; the backup itself is done"
  fi
fi
log "done: db/$name.dump"
