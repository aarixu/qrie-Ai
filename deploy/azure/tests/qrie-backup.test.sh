#!/usr/bin/env bash
# Tests ../backup/qrie-backup.sh without a database or Azure: its two address
# functions and its upload function (taken from the file, the upload run
# against a stand-in azcopy), and that it refuses bad settings before doing
# anything.
#   bash deploy/azure/tests/qrie-backup.test.sh
set -uo pipefail
shopt -u patsub_replacement 2>/dev/null || true
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SRC=$HERE/../backup/qrie-backup.sh
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
awk '/^percent_decode\(\) \{/,/^\}/ { print } /^split_db_url\(\) \{/,/^\}/ { print }' "$SRC" > "$T/fns.sh"
# shellcheck source=/dev/null
. "$T/fns.sh"
pass=0; failn=0
ok() { echo "PASS: $*"; pass=$((pass + 1)); }
bad() { echo "FAIL: $*"; failn=$((failn + 1)); }
check() { # uri, wanted address without the password, wanted password
  if split_db_url "$1"; then
    if [ "$DB_URL_NO_PASSWORD" = "$2" ] && [ "$DB_PASSWORD" = "$3" ]; then ok "$1"; else bad "$1 -> [$DB_URL_NO_PASSWORD] [$DB_PASSWORD]"; fi
  else
    bad "$1 refused"
  fi
}

check 'postgresql://postgres.abcdefghijklmnopqrst:Secret123@aws-0-ap-south-1.pooler.supabase.com:5432/postgres' \
  'postgresql://postgres.abcdefghijklmnopqrst@aws-0-ap-south-1.pooler.supabase.com:5432/postgres' 'Secret123'
check 'postgres://u:p%40ss%3Aw%2Fd%25x%27y%5Cz@h:5432/db?sslmode=require' 'postgresql://u@h:5432/db?sslmode=require' "p@ss:w/d%x'y\\z"
check 'postgresql://u:a:b@c@h:5432/db' 'postgresql://u@h:5432/db' 'a:b@c'
check 'postgresql://u:back\slash@h/db' 'postgresql://u@h/db' 'back\slash'
check 'postgresql://u@h:5432/db' 'postgresql://u@h:5432/db' ''
split_db_url 'mysql://u:p@h/db' && bad "mysql:// accepted" || ok "mysql:// refused"
split_db_url 'postgresql://h:5432/db' && bad "no user accepted" || ok "an address with no user is refused"

# The upload, with a stand-in azcopy that writes down its arguments, one a line.
# With a SAS that may only Create and Write, azcopy's length check after the
# upload (on by default) would read the blob's properties, which takes Read.
awk '/^upload\(\) \{/,/^\}/ { print }' "$SRC" > "$T/upload.sh"
grep -q '^upload() {' "$T/upload.sh" || bad "no upload() in $SRC"
mkdir -p "$T/bin"
cat > "$T/bin/azcopy" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$AZCOPY_ARGS_FILE"
EOF
chmod +x "$T/bin/azcopy"
: > "$T/x.dump"
(
  log() { :; }
  fail() { echo "fail: $*" >&2; exit 1; }
  container='https://acct.blob.core.windows.net/c' sas='sv=1&sp=cw&sig=2' work=$T
  export AZCOPY_ARGS_FILE=$T/azcopy-args PATH="$T/bin:$PATH"
  # shellcheck source=/dev/null
  . "$T/upload.sh"
  upload "$T/x.dump" x.dump
) 2> "$T/e4" || bad "upload failed: $(cat "$T/e4")"
args() { grep -qxF -- "$1" "$T/azcopy-args" 2>/dev/null; }
args 'copy' && ok "upload runs azcopy copy" || bad "upload: azcopy was not run with copy: $(cat "$T/azcopy-args" 2>/dev/null)"
args 'https://acct.blob.core.windows.net/c/db/x.dump?sv=1&sp=cw&sig=2' && ok "upload names db/<file> with the SAS" ||
  bad "upload: wrong destination: $(cat "$T/azcopy-args" 2>/dev/null)"
args '--check-length=false' && ok "upload passes --check-length=false" || bad "upload: no --check-length=false"
args '--put-md5' && ok "upload passes --put-md5" || bad "upload: no --put-md5"

# The whole script refuses before any work.
SUPABASE_DB_URL='' AZURE_BLOB_SAS_URL='x' bash "$SRC" 2> "$T/e1" > /dev/null && bad "empty database address accepted" ||
  { grep -q 'SUPABASE_DB_URL is not set' "$T/e1" && ok "empty database address refused" || bad "e1: $(cat "$T/e1")"; }
SUPABASE_DB_URL='postgresql://u:p@h/db' AZURE_BLOB_SAS_URL='https://acct.blob.core.windows.net/c' bash "$SRC" 2> "$T/e2" > /dev/null && bad "SAS address without a SAS accepted" ||
  { grep -q 'AZURE_BLOB_SAS_URL must look like' "$T/e2" && ok "SAS address without a SAS refused" || bad "e2: $(cat "$T/e2")"; }
SUPABASE_DB_URL='nope' AZURE_BLOB_SAS_URL='https://acct.blob.core.windows.net/c?sv=1&sig=2' bash "$SRC" 2> "$T/e3" > /dev/null && bad "bad database address accepted" ||
  { grep -q 'SUPABASE_DB_URL must look like' "$T/e3" && ok "bad database address refused" || bad "e3: $(cat "$T/e3")"; }

echo "passed $pass, failed $failn"
[ "$failn" = 0 ]
