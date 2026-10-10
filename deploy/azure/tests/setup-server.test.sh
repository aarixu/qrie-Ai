#!/usr/bin/env bash
# Tests what of ../setup-server.sh can be checked off the VM: that bash parses
# it, and the nginx log rotation it installs (../nginx/nginx.logrotate): daily,
# 180 old logs kept, compressed. Where logrotate is installed (not in Git
# Bash), it also reads the file with --debug, which changes nothing.
#   bash deploy/azure/tests/setup-server.test.sh
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SETUP=$HERE/../setup-server.sh
ROTATE=$HERE/../nginx/nginx.logrotate
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
pass=0; failn=0
ok() { echo "PASS: $*"; pass=$((pass + 1)); }
bad() { echo "FAIL: $*"; failn=$((failn + 1)); }

bash -n "$SETUP" && ok "bash parses setup-server.sh" || bad "bash -n setup-server.sh"

if [ -f "$ROTATE" ]; then
  # As setup installs it: Windows line endings taken out, then without comments.
  sed 's/\r$//' "$ROTATE" > "$T/nginx"
  grep -v '^[[:space:]]*#' "$T/nginx" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' > "$T/lines"
  [ "$(head -n 1 "$T/lines")" = '/var/log/nginx/*.log {' ] && ok "it rotates /var/log/nginx/*.log" ||
    bad "first line: $(head -n 1 "$T/lines")"
  grep -qx 'daily' "$T/lines" && ok "daily" || bad "no daily"
  [ "$(grep -c '^rotate ' "$T/lines")" = 1 ] && grep -qx 'rotate 180' "$T/lines" && ok "rotate 180, and no other rotate" ||
    bad "rotate: $(grep '^rotate' "$T/lines" | tr '\n' ' ')"
  grep -qx 'compress' "$T/lines" && ok "compress" || bad "no compress"
  grep -Eq '^(maxage|maxsize|size) ' "$T/lines" && bad "an age or size limit could cut it short of 180 days" ||
    ok "no age or size limit"
  [ "$(grep -c '{$' "$T/lines")" = "$(grep -cx '}' "$T/lines")" ] && ok "every { has its }" || bad "the braces do not pair"
  if command -v logrotate > /dev/null; then
    logrotate --debug --state "$T/state" "$T/nginx" > "$T/debug" 2>&1 && ok "logrotate --debug reads it" ||
      bad "logrotate --debug: $(cat "$T/debug")"
  else
    echo "SKIP: logrotate is not installed here"
  fi
else
  bad "no $ROTATE"
fi

# setup-server.sh puts it in place of the nginx package's file.
grep -q 'nginx/nginx.logrotate' "$SETUP" && grep -q '/etc/logrotate.d/nginx' "$SETUP" &&
  ok "setup-server.sh installs it as /etc/logrotate.d/nginx" || bad "setup-server.sh does not install it"

echo "passed $pass, failed $failn"
[ "$failn" = 0 ]
