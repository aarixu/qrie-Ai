#!/usr/bin/env bash
# Exercises ../activate-release.sh in a scratch folder, with the two root
# commands (nginx -t, the reload) replaced by stubs:
#   bash deploy/azure/tests/activate-release.test.sh
# On Windows (Git Bash) it needs symbolic links, which Developer Mode allows.
set -uo pipefail
export MSYS=winsymlinks:nativestrict
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/www/teacher/releases" "$T/www/app/releases" "$T/home/qrie-upload" "$T/build"

# The copy under test: the same file with the folder and the root commands replaced.
awk -v www="$T/www" '
  /^WWW=\/var\/www\/qrie$/ { print "WWW=" www; next }
  /^KEEP=5$/ { print; print "nginx_t() { if [ -n \"${NGINX_FAIL:-}\" ]; then echo \"nginx -t: FAIL\" >&2; return 1; fi; echo nginx-t-ok; }"; next }
  { gsub(/sudo -n \/usr\/sbin\/nginx -t/, "nginx_t"); gsub(/sudo -n \/usr\/bin\/systemctl reload nginx/, "echo nginx-reloaded"); print }
' "$HERE/../activate-release.sh" > "$T/act.sh"
grep -q 'sudo' "$T/act.sh" && { echo "FAIL: a sudo call was not replaced"; exit 1; }

export HOME="$T/home"
pass=0; failn=0
ok() { echo "PASS: $*"; pass=$((pass + 1)); }
bad() { echo "FAIL: $*"; failn=$((failn + 1)); }
pack() { # site stamp n
  local d="$T/build/$1-$2"
  rm -rf "$d"; mkdir -p "$d/assets"
  echo "<script type=module src=/assets/index-$3.js>" > "$d/index.html"
  echo "js $3" > "$d/assets/index-$3.js"
  echo "chunk $3" > "$d/assets/chunk-$3.js"
  tar -czf "$T/home/qrie-upload/qrie-$1-$2.tgz" -C "$d" .
}
live() { basename "$(readlink -f "$T/www/$1/current")"; }

pack teacher 20261010-100000 1; pack app 20261010-100000 1
bash "$T/act.sh" 20261010-100000 teacher app > /dev/null && ok "first deploy of two sites" || bad "first deploy"
[ "$(live teacher)" = 20261010-100000 ] && ok "teacher is live" || bad "teacher live: $(live teacher)"
[ "$(live app)" = 20261010-100000 ] && ok "app is live" || bad "app live: $(live app)"
[ -f "$T/www/teacher/releases/20261010-100000.own" ] && ok "the release's own files are listed" || bad ".own missing"
[ ! -e "$T/home/qrie-upload/qrie-teacher-20261010-100000.tgz" ] && ok "the upload is removed" || bad "upload left"

pack teacher 20261010-110000 2
bash "$T/act.sh" 20261010-110000 teacher > /dev/null
[ -f "$T/www/teacher/current/assets/index-1.js" ] && ok "the live release's assets are carried" || bad "not carried"
[ -f "$T/www/teacher/current/assets/index-2.js" ] && ok "the new assets are there" || bad "new asset missing"
grep -q index-1 "$T/www/teacher/releases/20261010-110000.own" && bad ".own lists a carried file" || ok ".own lists only the release's own files"

pack teacher 20261010-120000 3
bash "$T/act.sh" 20261010-120000 teacher > /dev/null
[ ! -e "$T/www/teacher/current/assets/index-1.js" ] && ok "files two releases back are not carried" || bad "two-back carried"
[ -f "$T/www/teacher/current/assets/index-2.js" ] && ok "files one release back are carried" || bad "one-back missing"

pack teacher 20261010-130000 4
NGINX_FAIL=1 bash "$T/act.sh" 20261010-130000 teacher > /dev/null 2>&1 && bad "went on after nginx -t failed" || ok "stops when nginx -t fails"
[ "$(live teacher)" = 20261010-120000 ] && ok "the live release is unchanged" || bad "live changed: $(live teacher)"
[ ! -e "$T/www/teacher/releases/20261010-130000" ] && ok "the unswitched folder is removed" || bad "folder left"
[ ! -e "$T/www/teacher/releases/20261010-130000.own" ] && ok "its list is removed" || bad ".own left"

for n in 14 15 16 17 18; do pack teacher "20261010-${n}0000" "$n"; bash "$T/act.sh" "20261010-${n}0000" teacher > /dev/null; done
kept=0; lists=0
for d in "$T/www/teacher/releases/"*; do case $d in *.own) lists=$((lists + 1)) ;; *) kept=$((kept + 1)) ;; esac; done
[ "$kept" = 5 ] && ok "five releases kept" || bad "kept $kept"
[ "$lists" = 5 ] && ok "five lists kept" || bad "lists kept $lists"
[ "$(live teacher)" = 20261010-180000 ] && ok "the newest is live" || bad "live $(live teacher)"

bash "$T/act.sh" --rollback teacher > /dev/null && ok "rollback runs" || bad "rollback"
[ "$(live teacher)" = 20261010-170000 ] && ok "rollback goes to the release before" || bad "after rollback $(live teacher)"
bash "$T/act.sh" --rollback teacher > /dev/null
[ "$(live teacher)" = 20261010-160000 ] && ok "a second rollback goes one further" || bad "after 2nd rollback $(live teacher)"

bash "$T/act.sh" 20261010-190000 teacher 2> /dev/null && bad "missing upload accepted" || ok "a missing upload is refused"
bash "$T/act.sh" 2026 teacher 2> /dev/null && bad "bad stamp accepted" || ok "a bad stamp is refused"
pack teacher 20261010-200000 20
bash "$T/act.sh" 20261010-200000 nope 2> /dev/null && bad "unknown site accepted" || ok "an unknown site is refused"
pack app 20261010-100000 9
bash "$T/act.sh" 20261010-100000 app 2> /dev/null && bad "same stamp twice accepted" || ok "the same stamp twice is refused"

echo "passed $pass, failed $failn"
[ "$failn" = 0 ]
